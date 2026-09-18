# Hugging Face Spaces (Docker SDK) image for the FastAPI AI service.
#
# Chosen over Render for this service because the free CPU Space gives 16GB RAM
# against Render's 512MB — ChromaDB plus the LangChain/Gemini stack is tight in
# 512MB — and because it keeps the backend as the ONLY Render service, which
# keeps us inside Render's 750 free instance-hours per month.
FROM python:3.11-slim

# 3.9 cannot parse the `str | None` annotations this codebase uses; 3.11 is the
# same version the old EC2 box ran after upgrading.

WORKDIR /app

# Spaces run as a non-root user (uid 1000) and the filesystem is read-only
# except for the app dir and /tmp. Chroma must therefore write under /tmp.
ENV CHROMA_DIR=/tmp/chroma_db \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY ingest.py .
# Seed documents ship with the image: the Space filesystem is ephemeral, so
# anything ingested at runtime is lost on restart.
COPY data/ ./data/

# Spaces expose 7860 by default; `app_port` in the README frontmatter must
# match. $PORT is honoured too so the same image runs anywhere.
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
