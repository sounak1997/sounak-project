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
"""
import random
import time

from google.genai import errors

RETRYABLE_STATUS = {429, 500, 503}


def with_retries(fn, *, max_retries: int, base_delay: float):
    """Call fn(); on a retryable Gemini error, wait and try again up to max_retries."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except errors.APIError as e:
            code = getattr(e, "code", None)
            # Give up if it's not retryable, or we've used our last attempt.
            if code not in RETRYABLE_STATUS or attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
            time.sleep(delay)
