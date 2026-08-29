"""
The SAME RAG loop as app/rag.py + gemini_client.py, rebuilt with LangChain.

Point of this file: comparison. Read it next to the hand-built version and see
what LangChain collapses. It queries the SAME chroma_db/ index you already
built with `python ingest.py` — nothing is re-embedded or re-ingested.

The hand-built /ask does, in plain code:
    embed query -> Chroma query -> format context -> build prompt -> call Gemini
LangChain expresses those same steps as composable objects (a vector store, a
retriever, a prompt template, a chat model). Below we keep the steps explicit
(so we can also return source scores); the commented LCEL chain at the bottom
shows how they collapse into a single pipe once you trust it.
"""
from functools import lru_cache

import chromadb
from langchain_core.embeddings import Embeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_chroma import Chroma
from langchain_google_genai import ChatGoogleGenerativeAI

from app.config import settings
from app import embeddings as gemini_embeddings
from app.gemini_client import RAG_SYSTEM
from app.rag import COLLECTION


class _GeminiEmbeddings(Embeddings):
    """
    Adapts our existing Gemini embedding functions to LangChain's Embeddings
    interface. This is the important trick: by reusing embeddings.py, the query
    vectors are produced exactly like the stored document vectors (same model,
    768 dims, matching task_type) — so LangChain queries the identical space.

    (In a pure-LangChain app you'd use GoogleGenerativeAIEmbeddings here instead;
    we reuse ours to guarantee an apples-to-apples comparison on the same index.)
    """

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return gemini_embeddings.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        return gemini_embeddings.embed_query(text)


@lru_cache(maxsize=1)
def _build():
    """Construct the LangChain pieces once and reuse them."""
    client = chromadb.PersistentClient(path=settings.chroma_dir)
    vectorstore = Chroma(
        client=client,
        collection_name=COLLECTION,
        embedding_function=_GeminiEmbeddings(),
    )
    llm = ChatGoogleGenerativeAI(
        model=settings.model,
        google_api_key=settings.gemini_api_key,
        max_output_tokens=settings.max_tokens,
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", RAG_SYSTEM),
            ("human", "Context:\n{context}\n\nQuestion: {question}\n\nAnswer using only the context above."),
        ]
    )
    return vectorstore, llm, prompt


def _format_docs(docs) -> str:
    return "\n\n".join(
        f"[Source: {d.metadata.get('source', '?')} #{d.metadata.get('chunk_index', -1)}]\n{d.page_content}"
        for d in docs
    )


def answer(question: str, k: int) -> dict:
    vectorstore, llm, prompt = _build()

    # 1. RETRIEVE — with scores, so the response matches /ask's shape.
    docs_scores = vectorstore.similarity_search_with_score(question, k=k)
    docs = [d for d, _ in docs_scores]

    # 2. BUILD PROMPT + 3. GENERATE
    messages = prompt.invoke({"context": _format_docs(docs), "question": question})
    ai = llm.invoke(messages)

    # LangChain reports output_tokens as the TOTAL output (answer + thinking) and
    # breaks the thinking out under output_token_details.reasoning. Split them so
    # this matches the hand-built /ask, where output_tokens = answer only.
    usage = ai.usage_metadata or {}
    reasoning = (usage.get("output_token_details") or {}).get("reasoning", 0)
    total_output = usage.get("output_tokens", 0)
    return {
        "answer": ai.content,
        "model": settings.model,
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": max(total_output - reasoning, 0),
        "thinking_tokens": reasoning,
        "sources": [
            {
                "source": d.metadata.get("source", "?"),
                "chunk_index": d.metadata.get("chunk_index", -1),
                # Chroma (cosine space) returns a distance; 1 - distance ≈ similarity.
                "score": round(1 - dist, 4),
                "preview": d.page_content[:160],
            }
            for d, dist in docs_scores
        ],
    }


# The same pipeline as a single LCEL chain — this is the "collapse" LangChain is
# known for. We don't use it above only because we also want the source scores:
#
#   from langchain_core.runnables import RunnablePassthrough
#   from langchain_core.output_parsers import StrOutputParser
#   vectorstore, llm, prompt = _build()
#   retriever = vectorstore.as_retriever(search_kwargs={"k": k})
#   chain = (
#       {"context": retriever | _format_docs, "question": RunnablePassthrough()}
#       | prompt | llm | StrOutputParser()
#   )
#   answer_text = chain.invoke(question)
