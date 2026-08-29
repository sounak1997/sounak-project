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
    retrieval_k: int = 4            # how many chunks to pull per question
    chunk_size: int = 1000          # characters per chunk
    chunk_overlap: int = 150        # characters shared between neighboring chunks

    # --- Resilience ---
    max_retries: int = 3            # retries on 429/500/503 before giving up
    retry_base_delay: float = 0.5   # seconds; grows exponentially per attempt


settings = Settings()
