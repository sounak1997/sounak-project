"""
The single place we talk to Gemini.

Keeping the LLM call in its own module (not inline in the route) is the same
separation-of-concerns you already use in Express: routes handle HTTP, a
service/client handles the real work.

Two public methods:
  chat()                → plain, ungrounded answer (Day 1-2)
  answer_with_context() → RAG: answer using retrieved chunks (Day 5-8)
Both go through the same private _generate(), so there's exactly one place that
actually calls the model.
"""
from google import genai
from google.genai import types

from app.config import settings
from app.schemas import ChatResponse
from app.retries import with_retries

DEFAULT_SYSTEM = (
    "You are a helpful assistant embedded in Sounak's app. "
    "Answer clearly and concisely."
)

# For RAG we constrain the model hard: answer only from what we retrieved, and
# admit when the documents don't contain the answer. This is what makes answers
# "grounded" and is the main defense against confidently-wrong hallucinations.
RAG_SYSTEM = (
    "You answer strictly using the provided context. "
    "If the answer is not contained in the context, say you don't know based on "
    "the available documents. Do not use outside knowledge and do not invent facts. "
    "Be concise."
)


class GeminiClient:
    def __init__(self) -> None:
        # api_key=None makes the SDK read GEMINI_API_KEY from the environment,
        # but genai.Client() raises without a key, so only build it when we have
        # one — that keeps the app booting (and /health working) without a key.
        self._client = (
            genai.Client(api_key=settings.gemini_api_key)
            if settings.gemini_api_key
            else None
        )

    def _generate(self, contents: str, system: str) -> ChatResponse:
        # The ONE place we call the model. Nothing hidden:
        #   contents           → the conversation / prompt text
        #   system_instruction → standing instructions that steer behavior
        #   max_output_tokens  → hard cap on the REPLY length (not the input)
        response = with_retries(
            lambda: self._client.models.generate_content(
                model=settings.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=settings.max_tokens,
                ),
            ),
            max_retries=settings.max_retries,
            base_delay=settings.retry_base_delay,
        )

        usage = response.usage_metadata
        finish_reason = (
            response.candidates[0].finish_reason if response.candidates else None
        )

        return ChatResponse(
            reply=response.text or "",
            model=settings.model,
            input_tokens=usage.prompt_token_count or 0,
            output_tokens=usage.candidates_token_count or 0,
            # gemini-2.5-flash "thinks" before answering; those tokens are billed
            # but excluded from candidates_token_count. Surface them, don't hide.
            thinking_tokens=getattr(usage, "thoughts_token_count", 0) or 0,
            stop_reason=str(finish_reason) if finish_reason else None,
        )

    def chat(self, message: str, system: str | None = None) -> ChatResponse:
        """Plain answer — no retrieval."""
        return self._generate(message, system or DEFAULT_SYSTEM)

    def stream_chat(self, message: str, system: str | None = None):
        """
        Same call as chat(), but streamed: yields the reply piece by piece as
        the model produces it, instead of waiting for the whole thing.

        Yields dicts (not SSE strings — formatting is the route's job):
            {"delta": "some text"}   for each token/burst
            {"done": True, "input_tokens": N, "output_tokens": N}  at the end
        """
        stream = self._client.models.generate_content_stream(
            model=settings.model,
            contents=message,
            config=types.GenerateContentConfig(
                system_instruction=system or DEFAULT_SYSTEM,
                max_output_tokens=settings.max_tokens,
            ),
        )

        usage = None
        for chunk in stream:
            text = getattr(chunk, "text", None)
            if text:
                yield {"delta": text}
            # usage_metadata shows up on the final chunk; capture it whenever set.
            if chunk.usage_metadata:
                usage = chunk.usage_metadata

        yield {
            "done": True,
            "input_tokens": (usage.prompt_token_count or 0) if usage else 0,
            "output_tokens": (usage.candidates_token_count or 0) if usage else 0,
            "thinking_tokens": (getattr(usage, "thoughts_token_count", 0) or 0) if usage else 0,
        }

    def answer_with_context(self, question: str, context_chunks: list[dict]) -> ChatResponse:
        """RAG answer — the retrieved chunks become the ONLY allowed knowledge."""
        # Build the context block. Labeling each chunk with its source is what
        # lets the model (and you) trace an answer back to a document.
        context = "\n\n".join(
            f"[Source: {c['source']} #{c['chunk_index']}]\n{c['text']}"
            for c in context_chunks
        ) or "(no relevant documents were found)"

        prompt = (
            f"Context:\n{context}\n\n"
            f"Question: {question}\n\n"
            "Answer using only the context above."
        )
        return self._generate(prompt, RAG_SYSTEM)
