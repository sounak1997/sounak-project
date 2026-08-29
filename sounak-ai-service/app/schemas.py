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
