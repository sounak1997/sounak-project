"""
Read raw text out of the files in the data/ folder.

Supports .md, .txt, and .pdf. Everything downstream (chunking, embedding) works
on plain strings, so this is the only place that cares about file formats.
"""
from pathlib import Path

from pypdf import PdfReader

SUPPORTED = {".md", ".txt", ".pdf"}


def load_document(path: Path) -> dict | None:
    """Read one file. Returns None if it's unsupported or has no extractable text."""
    if path.suffix.lower() not in SUPPORTED:
        return None

    if path.suffix.lower() == ".pdf":
        text = _read_pdf(path)
    else:
        text = path.read_text(encoding="utf-8", errors="ignore")

    if not text.strip():
        return None
    return {"source": path.name, "text": text}


def load_documents(data_dir: str) -> list[dict]:
    """Return [{"source": <filename>, "text": <full text>}] for every readable file."""
    docs: list[dict] = []
    base = Path(data_dir)
    if not base.exists():
        return docs

    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        doc = load_document(path)
        if doc:
            docs.append(doc)

    return docs


def _read_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    # extract_text() can return None for image-only pages; coalesce to "".
    return "\n".join(page.extract_text() or "" for page in reader.pages)
