"""
Request/response shapes for the API.

Pydantic models here do two jobs at once: they validate incoming JSON (a bad
request gets an automatic 422 before your code runs) and they document the API
(FastAPI turns them into the interactive docs at /docs).
"""
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="What the user typed.")
    system: str | None = Field(
        None,
        description="Optional system prompt to steer the assistant's behavior.",
    )


class ChatResponse(BaseModel):
    reply: str
    model: str
    # Token counts come straight from the model response. Watching these is the
    # fastest way to build intuition for what things cost and how big your
    # context is getting.
    input_tokens: int
    output_tokens: int          # visible answer tokens
    thinking_tokens: int = 0    # hidden "thinking" tokens — billed but not shown in the reply
    stop_reason: str | None


# --- RAG (/ask) ---
class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, description="The user's question.")
    k: int | None = Field(
        None, ge=1, le=20, description="How many chunks to retrieve (default from config)."
    )


class SourceChunk(BaseModel):
    """One retrieved chunk, returned so you can SEE what the answer was grounded on."""
    source: str
    chunk_index: int
    score: float          # cosine similarity; higher = more relevant
    preview: str          # first slice of the chunk text


class AskResponse(BaseModel):
    answer: str
    model: str
    input_tokens: int
    output_tokens: int          # visible answer tokens
    thinking_tokens: int = 0    # hidden "thinking" tokens — billed but not shown
    sources: list[SourceChunk]


# --- Document management (/documents) ---
class DocumentInfo(BaseModel):
    source: str
    chunk_count: int


class DocumentListResponse(BaseModel):
    documents: list[DocumentInfo]


class UploadResponse(BaseModel):
    source: str
    chunks_indexed: int


class DeleteResponse(BaseModel):
    source: str
    chunks_removed: int


# --- Agent (/agent) ---
#
# The agent endpoint is stateless like everything else here: the client owns the
# conversation and replays it each turn. That matches the stateless-JWT style of
# the Node backend and means no session store to expire, share, or scale.


class AgentTurn(BaseModel):
    """One past message, replayed by the client so the model has context."""
    role: str = Field(..., pattern="^(user|assistant)$")
    text: str


class AgentRequest(BaseModel):
    message: str = Field(..., min_length=1, description="What the user typed.")
    history: list[AgentTurn] = Field(
        default_factory=list,
        description="Prior turns, oldest first. The client trims this.",
    )
    # Forwarded by the Node backend from the caller's Authorization header.
    # Server-side tools present it when calling back into the Node API, so the
    # agent inherits exactly the caller's permissions — never more.
    auth_token: str | None = Field(None, description="The end user's JWT, forwarded by Node.")


class AgentAction(BaseModel):
    """
    Something for the BROWSER to do — navigating, highlighting, opening a panel.

    The model "calls" these like any other tool, but the Python service never
    executes them; it records them here and tells the model they succeeded. The
    Angular UiActionService is what actually runs them.
    """
    type: str
    params: dict = Field(default_factory=dict)


class PendingAction(BaseModel):
    """
    A write the model wants to perform, held back until a human clicks Confirm.

    Nothing that changes data is executed inside the loop. The model proposes;
    the user disposes — via POST /agent/confirm.
    """
    tool: str
    args: dict
    label: str          # button text, e.g. "Create user"
    summary: str        # human-readable description of what will happen


class ToolTrace(BaseModel):
    """One tool invocation, surfaced to the UI so the run is inspectable."""
    tool: str
    kind: str           # server | client | confirm
    args: dict
    ok: bool
    detail: str = ""    # short result summary or the error message


class AgentResponse(BaseModel):
    reply: str
    actions: list[AgentAction] = Field(default_factory=list)
    pending: list[PendingAction] = Field(default_factory=list)
    trace: list[ToolTrace] = Field(default_factory=list)
    iterations: int = 0
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0


class ConfirmRequest(BaseModel):
    """Execute a previously-proposed write, after the user clicked Confirm."""
    tool: str
    args: dict = Field(default_factory=dict)
    auth_token: str | None = None


class ConfirmResponse(BaseModel):
    reply: str
    ok: bool
    actions: list[AgentAction] = Field(default_factory=list)
    trace: list[ToolTrace] = Field(default_factory=list)
