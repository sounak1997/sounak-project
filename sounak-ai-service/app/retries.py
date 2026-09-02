"""
Retry transient Gemini failures with exponential backoff.

Some failures are worth retrying (the server was briefly busy), and some aren't
(your request was malformed). The difference is the HTTP status code:

    429  rate limited        → back off and retry  (very common on free tier)
    500  transient server    → retry
    503  service unavailable → retry
    400/401/404/...          → your fault, don't retry — fail fast

Backoff is exponential (0.5s, 1s, 2s, ...) plus a little random "jitter" so that
many callers retrying at once don't all wake up and hammer the API in lockstep.

LISTENING TO THE SERVER
-----------------------
On a 429 the API usually tells us exactly how long to wait, as a RetryInfo entry
in the error body ("retryDelay": "3s"). Guessing with a blind exponential when
the server has already given you the answer is how you end up retrying 0.5s into
a 3s window, burning all your attempts, and surfacing a failure that never had
to happen. That is not hypothetical — it's what the agent loop does on the free
tier, where the limit is a handful of requests per MINUTE and one agent turn
costs several. So: use the server's number when it gives one, cap it so a wild
value can't hang the request, and fall back to exponential when it doesn't.
"""
import random
import re
import time

from google.genai import errors

RETRYABLE_STATUS = {429, 500, 503}

# Never sleep longer than this on a server hint, no matter what it asks for —
# the caller has its own timeout and a 60s "retry later" is better surfaced as
# an error the user can see than as a request that appears to hang.
MAX_SERVER_DELAY = 30.0

_DELAY_IN_MESSAGE = re.compile(r"retry in (\d+(?:\.\d+)?)s", re.IGNORECASE)


def suggested_delay(e: errors.APIError) -> float | None:
    """
    Pull the server's own 'wait this long' hint out of an error, if present.

    Public because the HTTP layer uses it too, to turn a 429 into "try again in
    ~30s" instead of pasting Google's billing boilerplate into a chat bubble.
    """
    # 1. The structured form: google.rpc.RetryInfo in the error details.
    details = getattr(e, "details", None)
    if isinstance(details, dict):
        entries = details.get("error", {}).get("details", [])
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                if "RetryInfo" not in str(entry.get("@type", "")):
                    continue
                raw = str(entry.get("retryDelay", ""))       # e.g. "3s", "1.5s"
                try:
                    return float(raw.rstrip("s"))
                except ValueError:
                    pass

    # 2. The prose fallback: "Please retry in 3.187604816s."
    match = _DELAY_IN_MESSAGE.search(getattr(e, "message", "") or "")
    if match:
        return float(match.group(1))

    return None


def with_retries(fn, *, max_retries: int, base_delay: float, total_budget: float | None = None):
    """
    Call fn(); on a retryable Gemini error, wait and try again up to max_retries.

    `total_budget` caps the SUM of the sleeps. The agent loop makes several
    calls per turn behind a caller timeout, so an unbounded retry inside one
    call can eat the whole budget and surface as a timeout — which tells the
    user nothing. When the next sleep wouldn't fit, we stop and let the real
    429 through, so they get "you're rate limited, wait ~30s" instead.
    """
    slept = 0.0
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except errors.APIError as e:
            code = getattr(e, "code", None)
            # Give up if it's not retryable, or we've used our last attempt.
            if code not in RETRYABLE_STATUS or attempt == max_retries:
                raise

            hinted = suggested_delay(e)
            if hinted is not None:
                # Add a small margin — waiting exactly the suggested time tends
                # to land right on the boundary and 429 again.
                delay = min(hinted + 0.25, MAX_SERVER_DELAY)
            else:
                delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)

            if total_budget is not None and slept + delay > total_budget:
                raise

            slept += delay
            time.sleep(delay)
