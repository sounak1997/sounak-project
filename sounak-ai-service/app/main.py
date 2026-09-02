"""
FastAPI entrypoint — the equivalent of your Express server.js.

Run it in dev with:
    uvicorn app.main:app --reload --port 8000

Endpoints:
    GET  /health      liveness
    POST /chat        plain, ungrounded answer
    GET  /rag/status  how many chunks are indexed
    POST /ask         RAG: grounded answer + the sources it used
    POST /agent       tool-calling agent: reads live app data, drives the UI
    POST /agent/confirm  execute a write the user approved

Open http://localhost:8000/docs for interactive, auto-generated API docs.
"""
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from google.genai import errors as genai_errors

from app.config import settings
from app.schemas import (
    ChatRequest,
    ChatResponse,
    AskRequest,
    AskResponse,
    SourceChunk,
    DocumentListResponse,
    DocumentInfo,
    UploadResponse,
    DeleteResponse,
    AgentRequest,
    AgentResponse,
    ConfirmRequest,
    ConfirmResponse,
)
from app.gemini_client import GeminiClient
from app.rag import RagStore
from app.loaders import load_document, SUPPORTED as SUPPORTED_EXTENSIONS
from app.ingest_service import ingest_one
from app.retries import suggested_delay
from app import agent as agent_loop

app = FastAPI(title="Sounak AI Service", version="0.2.0")

# CORS — "*" is fine for local dev; lock it down before public exposure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Built once at startup and reused. Neither needs an API key to construct, so
# the app still boots and /health still works before you've added a key.
llm = GeminiClient()
store = RagStore()


def _require_key() -> None:
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
        )


def _map_gemini_error(e: genai_errors.APIError) -> HTTPException:
    # ClientError (4xx) and ServerError (5xx) both subclass APIError. Surface the
    # real status when we have one, otherwise treat it as a bad upstream (502).
    code = getattr(e, "code", None)
    status = code if isinstance(code, int) and 400 <= code < 600 else 502
    message = getattr(e, "message", str(e))

    # Google's 429 body is three paragraphs of billing links and metric names.
    # Dumping that into a chat bubble tells the user nothing they can act on, so
    # rewrite it as the two facts that matter: you're rate limited, wait N
    # seconds. The raw text stays in the server log for debugging.
    if status == 429:
        wait = suggested_delay(e)
        when = f"about {round(wait)}s" if wait else "a minute"
        return HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached on the free tier — try again in {when}. "
                "(One assistant turn costs several model calls, so it hits the "
                "per-minute cap faster than plain chat does.)"
            ),
        )

    return HTTPException(status_code=status, detail=message)


@app.get("/health")
def health():
    """Liveness check. Does NOT call Gemini — safe to hit without a valid key."""
    return {
        "status": "ok",
        "service": "sounak-ai-service",
        "model": settings.model,
        "api_key_configured": bool(settings.gemini_api_key),
    }


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    _require_key()
    try:
        return llm.chat(message=req.message, system=req.system)
    except genai_errors.APIError as e:
        raise _map_gemini_error(e)


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    """
    Streaming version of /chat as Server-Sent Events (SSE) — same wire format
    as the notification stream in the Node server. The browser (or Node proxy)
    receives a series of `data: {...}` lines as the model generates:
        data: {"delta": "Hello"}
        data: {"delta": " world"}
        data: {"done": true, "input_tokens": 12, "output_tokens": 34}
    """
    _require_key()

    def event_stream():
        try:
            for event in llm.stream_chat(req.message, req.system):
                yield f"data: {json.dumps(event)}\n\n"
        except genai_errors.APIError as e:
            mapped = _map_gemini_error(e)
            # Errors can happen mid-stream (after headers are sent), so we can't
            # change the HTTP status — we emit an error event instead.
            yield f"data: {json.dumps({'error': mapped.detail, 'status': mapped.status_code})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # stop nginx/proxies from buffering the stream
        },
    )


@app.get("/rag/status")
def rag_status():
    """How many chunks are indexed. 0 means you still need to run `python ingest.py`."""
    return {
        "indexed_chunks": store.count(),
        "embedding_model": settings.embedding_model,
    }


@app.get("/documents", response_model=DocumentListResponse)
def list_documents():
    """Every document currently indexed, with how many chunks each contributed."""
    return DocumentListResponse(
        documents=[DocumentInfo(**d) for d in store.list_sources()]
    )


@app.post("/documents", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Save an uploaded file into data/ and index it immediately — this is the
    "share a doc" step. Re-uploading the same filename replaces its chunks
    rather than duplicating them (see ingest_service.ingest_one).
    """
    _require_key()

    # Path(...).name strips any directory components the client might send,
    # so a crafted filename like "../../etc/passwd" can't escape data/.
    safe_name = Path(file.filename or "").name
    suffix = Path(safe_name).suffix.lower()
    if not safe_name or suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413, detail=f"File exceeds the {settings.max_upload_mb}MB limit."
        )

    data_dir = Path(settings.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    dest = data_dir / safe_name
    dest.write_bytes(content)

    doc = load_document(dest)
    if doc is None:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="File has no extractable text.")

    try:
        chunks_indexed = ingest_one(store, doc, settings.chunk_size, settings.chunk_overlap)
    except genai_errors.APIError as e:
        dest.unlink(missing_ok=True)
        raise _map_gemini_error(e)

    return UploadResponse(source=safe_name, chunks_indexed=chunks_indexed)


@app.delete("/documents/{source}", response_model=DeleteResponse)
def delete_document(source: str):
    """Remove a document's chunks from the index and delete its file from data/."""
    removed = store.delete_source(source)
    if removed == 0:
        raise HTTPException(status_code=404, detail=f"No indexed document named '{source}'.")

    file_path = Path(settings.data_dir) / Path(source).name
    file_path.unlink(missing_ok=True)

    return DeleteResponse(source=source, chunks_removed=removed)


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    _require_key()
    k = req.k or settings.retrieval_k
    try:
        # 1. RETRIEVE — find the chunks whose meaning is closest to the question.
        chunks = store.retrieve(req.question, k=k)
        # 2. GENERATE — hand those chunks to Gemini as the only allowed context.
        result = llm.answer_with_context(req.question, chunks)
    except genai_errors.APIError as e:
        raise _map_gemini_error(e)

    # 3. Return the answer AND the sources, so the answer is inspectable.
    return AskResponse(
        answer=result.reply,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        thinking_tokens=result.thinking_tokens,
        sources=[
            SourceChunk(
                source=c["source"],
                chunk_index=c["chunk_index"],
                score=c["score"],
                preview=c["text"][:160],
            )
            for c in chunks
        ],
    )


@app.post("/ask/langchain", response_model=AskResponse)
def ask_langchain(req: AskRequest):
    """
    Same thing as /ask, but built with LangChain instead of by hand. Queries the
    SAME chroma_db/ index. Run both on one question and compare — the answers
    should match; the interesting difference is in the code (app/rag.py +
    gemini_client.py vs app/langchain_rag.py).
    """
    _require_key()
    # Imported lazily so LangChain's heavy import cost is only paid if/when you
    # actually call this endpoint — the rest of the service stays snappy.
    from app import langchain_rag

    k = req.k or settings.retrieval_k
    try:
        result = langchain_rag.answer(req.question, k=k)
    except genai_errors.APIError as e:
        raise _map_gemini_error(e)
    except Exception as e:  # LangChain may wrap upstream errors in its own types
        raise HTTPException(status_code=502, detail=f"LangChain pipeline error: {e}")

    return AskResponse(
        answer=result["answer"],
        model=result["model"],
        input_tokens=result["input_tokens"],
        output_tokens=result["output_tokens"],
        thinking_tokens=result["thinking_tokens"],
        sources=[SourceChunk(**s) for s in result["sources"]],
    )


# --- Agent: tool calling ---------------------------------------------------

@app.post("/agent", response_model=AgentResponse)
def agent(req: AgentRequest):
    """
    The in-app assistant. Unlike /chat and /ask, this one can DO things:
    look up live data through the Node API, and ask the browser to navigate
    or highlight something.

    `auth_token` is the end user's own JWT, forwarded by the Node backend.
    Server-side tools present it on every call back into the API, so the agent
    can only ever see what the caller can.
    """
    _require_key()
    try:
        return agent_loop.run_agent(llm.raw, req, store)
    except genai_errors.APIError as e:
        raise _map_gemini_error(e)


@app.post("/agent/confirm", response_model=ConfirmResponse)
def agent_confirm(req: ConfirmRequest):
    """
    Execute a write the user explicitly approved in the UI.

    Only tools declared with kind="confirm" in the registry are reachable here —
    that allowlist, not the model's good behaviour, is what stops the assistant
    from writing to your database on its own.
    """
    ok, message, actions, trace = agent_loop.run_confirmed(req, store)
    return ConfirmResponse(reply=message, ok=ok, actions=actions, trace=trace)


@app.get("/agent/tools")
def agent_tools():
    """
    Introspection: what the assistant can currently do. Handy for debugging
    "why didn't it call that?" — if a tool isn't listed here, the model never
    saw it.
    """
    from app.tools import registry as _registry

    return {
        "tools": [
            {
                "name": t.name,
                "kind": t.kind,
                "description": t.declaration.description,
            }
            for t in _registry.TOOLS
        ],
        "max_iterations": settings.agent_max_iterations,
        "backend_url": settings.backend_url,
    }
