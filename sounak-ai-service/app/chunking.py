"""
Splitting documents into chunks — done by hand, no framework.

Why chunk at all? Two reasons:
  1. You retrieve *pieces* of documents, not whole files. A focused paragraph is
     a far better match for a question than a 40-page PDF.
  2. You only want to send the few relevant pieces to the model, not everything.

This is a simple character-window splitter with overlap. The overlap means a
sentence that straddles a boundary still appears whole in one of the chunks, so
retrieval doesn't miss it. Good enough to learn on; you can get fancier later
(split on headings, sentences, tokens).
"""


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    n = len(text)

    while start < n:
        end = min(start + chunk_size, n)

        # Prefer to end on a newline/space boundary near the target so we don't
        # slice through the middle of a word.
        if end < n:
            boundary = max(text.rfind("\n", start, end), text.rfind(" ", start, end))
            if boundary > start + chunk_size // 2:
                end = boundary

        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)

        if end >= n:
            break
        # Step forward, but leave `overlap` characters of tail behind us.
        start = max(end - overlap, start + 1)

    return chunks
