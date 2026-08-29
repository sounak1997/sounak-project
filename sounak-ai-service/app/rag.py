"""
The vector store — a thin wrapper over Chroma.

Chroma persists to disk (chroma_db/), so the index survives restarts. We embed
the text ourselves (embeddings.py) and hand Chroma the vectors, rather than
letting Chroma embed for us — that keeps the whole pipeline explicit and on
Gemini, with nothing hidden.

This class is the entire "retrieval" half of RAG. The "generation" half is the
normal Gemini call in gemini_client.py; /ask just glues them together.
"""
import chromadb

from app.config import settings
from app import embeddings

COLLECTION = "docs"
_COSINE = {"hnsw:space": "cosine"}  # similarity of meaning, ignoring vector length


class RagStore:
    def __init__(self) -> None:
        # Building the client does NOT need an API key (only embedding does),
        # so the app still boots and /health still works before you've ingested.
        self._client = chromadb.PersistentClient(path=settings.chroma_dir)
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION, metadata=_COSINE
        )

    def count(self) -> int:
        return self._collection.count()

    def reset(self) -> None:
        """Drop and recreate the collection — called before a fresh ingest."""
        self._client.delete_collection(COLLECTION)
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION, metadata=_COSINE
        )

    def add(self, chunks: list[dict]) -> None:
        """chunks: [{"id", "text", "source", "chunk_index"}]"""
        if not chunks:
            return
        vectors = embeddings.embed_documents([c["text"] for c in chunks])
        self._collection.add(
            ids=[c["id"] for c in chunks],
            documents=[c["text"] for c in chunks],
            embeddings=vectors,
            metadatas=[
                {"source": c["source"], "chunk_index": c["chunk_index"]} for c in chunks
            ],
        )

    def retrieve(self, query: str, k: int) -> list[dict]:
        """Return the k chunks whose meaning is closest to the query."""
        n = self._collection.count()
        if n == 0:
            return []

        result = self._collection.query(
            query_embeddings=[embeddings.embed_query(query)],
            n_results=min(k, n),
        )

        # Chroma returns one list-per-query; we sent one query, so take index 0.
        docs = result["documents"][0]
        metas = result["metadatas"][0]
        dists = result["distances"][0]

        return [
            {
                "text": text,
                "source": meta.get("source", "?"),
                "chunk_index": meta.get("chunk_index", -1),
                # cosine similarity ≈ 1 - cosine distance; higher = more relevant.
                "score": round(1 - dist, 4),
            }
            for text, meta, dist in zip(docs, metas, dists)
        ]
