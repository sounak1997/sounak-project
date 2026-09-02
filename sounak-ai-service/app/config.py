"""
Central config, loaded from environment variables (and the .env file in dev).

We use pydantic-settings because it's the FastAPI-idiomatic way to read config:
it validates types and reads .env automatically — the Python equivalent of the
`dotenv` + `process.env` pattern in your Express server.js.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ignore unrelated env vars instead of erroring
    )

    # The field name maps to the GEMINI_API_KEY env var (case-insensitive).
    # If None, we short-circuit with a clear 503 before ever building the client.
    gemini_api_key: str | None = None

    # Free-tier friendly default. Swap via the MODEL env var:
    #   gemini-2.5-flash       → balanced, free tier (default)
    #   gemini-2.5-flash-lite  → fastest / cheapest
    #   gemini-2.5-pro         → most capable
    model: str = "gemini-2.5-flash"

    # Hard cap on reply length, in tokens.
    max_tokens: int = 1024

    # --- RAG settings ---
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768        # smaller = faster/smaller store; must be consistent
    chroma_dir: str = "chroma_db"   # where the vector store persists on disk
    data_dir: str = "data"          # where your source documents live
    max_upload_mb: int = 10         # reject uploads larger than this
    retrieval_k: int = 4            # how many chunks to pull per question
    chunk_size: int = 1000          # characters per chunk
    chunk_overlap: int = 150        # characters shared between neighboring chunks

    # --- Resilience ---
    max_retries: int = 3            # retries on 429/500/503 before giving up
    retry_base_delay: float = 0.5   # seconds; grows exponentially per attempt

    # --- Agent (tool calling) ---
    # Where the Node/Express backend lives. Server-side tools call its REST API
    # with the end user's own JWT forwarded, so the agent can never see more
    # than the person talking to it can.
    backend_url: str = "http://localhost:3000"
    backend_timeout: float = 10.0   # seconds per tool HTTP call

    # The agent gets its OWN model, separate from chat/ask.
    #
    # Free-tier quota is metered PER MODEL, so putting the agent on a different
    # one gives it a separate bucket — a burst of agent turns stops starving the
    # /chat and /ask screens, and vice versa. flash-lite is also faster and
    # cheaper, and tool *selection* is an easy task when the descriptions are
    # clear: it's picking from a menu of nine, not writing prose.
    # NOTE: gemini-2.5-flash-lite is retired for new keys — the API tells you to
    # move to the 3.5 line. Check what your key can actually reach with
    # `client.models.list()` before pinning a different one here.
    # Set AGENT_MODEL=gemini-2.5-flash to put it back on the bigger model.
    agent_model: str = "gemini-3.5-flash-lite"

    # Ceiling on how long one model call may spend sleeping between retries.
    # A 429 can ask us to wait ~30s; three of those inside a loop that makes
    # several calls would blow past the Node timeout and surface as a confusing
    # 504 instead of an honest "you're rate limited".
    agent_retry_budget: float = 20.0

    # Hard stop on the think -> call tool -> think again cycle. Without a cap a
    # confused model can ping-pong between tools forever, burning quota.
    #
    # 8 rather than 5 because a guided walkthrough legitimately needs a handful:
    # navigate, then one highlight per field. The model *can* emit those in one
    # turn and often does, but it isn't guaranteed to.
    agent_max_iterations: int = 8

    # Agent replies need more room than plain chat: on gemini-2.5-flash the
    # max_output_tokens budget is shared with the hidden "thinking" tokens, and
    # tool-planning thinks a lot. Too low and you get an empty reply.
    agent_max_tokens: int = 2048

    # How many rows a list-style tool may put into the model's context. The
    # tool still reports the TRUE total separately, so "how many" stays correct
    # even when the sample is trimmed.
    tool_result_limit: int = 25


settings = Settings()
