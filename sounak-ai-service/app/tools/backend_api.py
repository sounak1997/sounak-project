"""
The agent's HTTP client for the Node/Express backend.

TRUST BOUNDARY
--------------
This is the ONLY place the AI service reaches back into your application data,
and it always travels with the end user's own JWT (forwarded by Node from the
caller's Authorization header). The agent therefore inherits exactly the
permissions of the person chatting — never a service account, never more.

Three consequences worth internalising:
  1. If the user's token expired mid-conversation, tools start returning 401 and
     the model gets told so — it can say "your session expired" instead of
     silently inventing data.
  2. Nothing here builds URLs from model output. The model chooses a *tool* and
     fills declared *parameters*; the path is hardcoded below. A prompt
     injection in an uploaded document cannot make it call an arbitrary URL.
  3. Every call is time-boxed, so a slow backend can't hold the agent loop open
     until the caller's own request times out.
"""
import httpx

from app.config import settings


class BackendError(Exception):
    """A tool's HTTP call failed. Carries a status so the loop can explain it."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _headers(auth_token: str | None) -> dict:
    headers = {"Accept": "application/json"}
    if auth_token:
        # Node hands us the raw header value, which may or may not already say
        # "Bearer". Normalise so both forms work.
        value = auth_token if auth_token.lower().startswith("bearer ") else f"Bearer {auth_token}"
        headers["Authorization"] = value
    return headers


def request(method: str, path: str, auth_token: str | None, json_body: dict | None = None):
    """
    Call the Node backend and return its parsed JSON body.

    `path` is always a literal written by us (see registry.py) — never a string
    the model produced.
    """
    url = f"{settings.backend_url}{path}"
    try:
        with httpx.Client(timeout=settings.backend_timeout) as client:
            response = client.request(
                method, url, headers=_headers(auth_token), json=json_body
            )
    except httpx.TimeoutException:
        raise BackendError(f"The backend did not respond within {settings.backend_timeout}s.", 504)
    except httpx.RequestError as e:
        raise BackendError(f"Could not reach the backend: {e}", 502)

    if response.status_code == 401:
        raise BackendError(
            "Not authorised — the user's session has expired or is invalid.", 401
        )

    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            detail = body.get("message") or body.get("detail") or ""
        except Exception:
            detail = response.text[:200]
        raise BackendError(
            f"Backend returned {response.status_code}{f': {detail}' if detail else ''}",
            response.status_code,
        )

    try:
        return response.json()
    except Exception:
        raise BackendError("Backend returned a non-JSON response.", 502)


def get(path: str, auth_token: str | None):
    return request("GET", path, auth_token)


def post(path: str, auth_token: str | None, json_body: dict):
    return request("POST", path, auth_token, json_body)


def unwrap(payload):
    """
    Normalise the two response shapes this backend uses.

    /api/users returns a bare array; /api/products/... returns
    {success, data, count}. Tools shouldn't have to care, and the model
    definitely shouldn't — it sees one consistent shape.
    """
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload
