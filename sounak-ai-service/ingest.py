"""
Build (or rebuild) the vector index from the files in data/.

    python ingest.py

Reads every supported file in data/, splits each into overlapping chunks,
embeds them with Gemini, and stores them in Chroma (chroma_db/). Safe to re-run
any time you add or change documents — it clears the old index first.

(Uploading a single file through the running service, via POST /documents,
uses the same chunking logic but adds it without wiping the rest — see
app/ingest_service.py.)
"""
from app.config import settings
from app.loaders import load_documents
from app.ingest_service import ingest_all
from app.rag import RagStore


def main() -> None:
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set. Add it to .env first.")
        return

    docs = load_documents(settings.data_dir)
    if not docs:
        print(f"No documents in {settings.data_dir}/. Add .md/.txt/.pdf files and re-run.")
        return

    print(f"Loaded {len(docs)} document(s). Embedding + indexing...")
    store = RagStore()
    chunks = ingest_all(store, docs, settings.chunk_size, settings.chunk_overlap)

    print(f"Done. {store.count()} chunks indexed in '{settings.chroma_dir}/'.")
    for doc in docs:
        n = sum(1 for c in chunks if c["source"] == doc["source"])
        print(f"  - {doc['source']}: {n} chunk(s)")


if __name__ == "__main__":
    main()
