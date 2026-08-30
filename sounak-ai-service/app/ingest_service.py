"""
Turns a loaded document into indexed chunks. Shared by ingest.py (full rebuild
from data/) and the /documents upload endpoint (one file, added on the fly) —
one place owns "how a document becomes chunks in the store."
"""
from app.chunking import chunk_text
from app.rag import RagStore


def build_chunks(doc: dict, chunk_size: int, overlap: int) -> list[dict]:
    """doc: {"source", "text"} -> [{"id", "text", "source", "chunk_index"}]"""
    return [
        {
            "id": f"{doc['source']}::{i}",
            "text": piece,
            "source": doc["source"],
            "chunk_index": i,
        }
        for i, piece in enumerate(chunk_text(doc["text"], chunk_size, overlap))
    ]


def ingest_all(store: RagStore, docs: list[dict], chunk_size: int, overlap: int) -> list[dict]:
    """Full rebuild: wipe the store, index every document in `docs`. Returns the chunks."""
    chunks = [c for doc in docs for c in build_chunks(doc, chunk_size, overlap)]
    store.reset()
    store.add(chunks)
    return chunks


def ingest_one(store: RagStore, doc: dict, chunk_size: int, overlap: int) -> int:
    """
    Add (or replace) a single document. If a document with the same source
    name is already indexed, its old chunks are removed first, so
    re-uploading a file updates it instead of duplicating it.
    """
    store.delete_source(doc["source"])
    chunks = build_chunks(doc, chunk_size, overlap)
    store.add(chunks)
    return len(chunks)
