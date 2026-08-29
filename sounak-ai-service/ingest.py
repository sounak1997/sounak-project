"""
Build (or rebuild) the vector index from the files in data/.

    python ingest.py

Reads every supported file in data/, splits each into overlapping chunks,
embeds them with Gemini, and stores them in Chroma (chroma_db/). Safe to re-run
any time you add or change documents — it clears the old index first.
"""
from app.config import settings
from app.loaders import load_documents
from app.chunking import chunk_text
from app.rag import RagStore


def main() -> None:
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set. Add it to .env first.")
        return

    docs = load_documents(settings.data_dir)
    if not docs:
        print(f"No documents in {settings.data_dir}/. Add .md/.txt/.pdf files and re-run.")
        return

    # Flatten every document into id'd chunks.
    chunks: list[dict] = []
    for doc in docs:
        for i, piece in enumerate(
            chunk_text(doc["text"], settings.chunk_size, settings.chunk_overlap)
        ):
            chunks.append(
                {
                    "id": f"{doc['source']}::{i}",
                    "text": piece,
                    "source": doc["source"],
                    "chunk_index": i,
                }
            )

    print(f"Loaded {len(docs)} document(s) -> {len(chunks)} chunk(s). Embedding + indexing...")
    store = RagStore()
    store.reset()
    store.add(chunks)

    print(f"Done. {store.count()} chunks indexed in '{settings.chroma_dir}/'.")
    for doc in docs:
        n = sum(1 for c in chunks if c["source"] == doc["source"])
        print(f"  - {doc['source']}: {n} chunk(s)")


if __name__ == "__main__":
    main()
