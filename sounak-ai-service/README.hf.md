---
title: Sounak AI Service
emoji: 🤖
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Sounak AI Service

FastAPI + Gemini RAG service backing the sounak-project stack.

Rename this file to `README.md` in the Hugging Face Space repo — Spaces read
the YAML frontmatter above to know it is a Docker Space and which port to
expose.

## Required Space secrets

Set under Settings → Variables and secrets:

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API access |
| `INTERNAL_API_KEY` | must match `AI_INTERNAL_KEY` on the Render backend |
| `MODEL` | `gemini-2.5-flash` |
| `MAX_TOKENS` | `1024` |

Without `INTERNAL_API_KEY` set the auth middleware is disabled and the service
is open to anyone who finds it. Free Spaces are publicly reachable, so set it.

`/health` stays unauthenticated so the platform health check works.
