"""
Turn text into vectors (embeddings) with Gemini.

An embedding is a list of floats that captures the *meaning* of a piece of text.
Texts with similar meaning land close together in this vector space — and that
"closeness" is exactly what retrieval measures to find relevant chunks.

Note the task_type: Gemini embeds documents and questions a little differently
(RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY) so a question lands near the passages
that answer it. Small knob, real accuracy win — the kind of detail a framework
would hide from you.
"""
from google import genai
from google.genai import types

from app.config import settings
from app.retries import with_retries

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set.")
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _embed(texts: list[str], task_type: str) -> list[list[float]]:
    # Embedding is where you hit rate limits first (ingest fires many calls in a
    # row), so the retry/backoff wrapper matters most here.
    response = with_retries(
        lambda: _get_client().models.embed_content(
            model=settings.embedding_model,
            contents=texts,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=settings.embedding_dim,
            ),
        ),
        max_retries=settings.max_retries,
        base_delay=settings.retry_base_delay,
    )
    return [e.values for e in response.embeddings]


def embed_documents(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    """Embed many chunks for storage. Batched to stay under per-request limits."""
    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        out.extend(_embed(texts[i : i + batch_size], task_type="RETRIEVAL_DOCUMENT"))
    return out


def embed_query(text: str) -> list[float]:
    """Embed a single question for lookup."""
    return _embed([text], task_type="RETRIEVAL_QUERY")[0]
