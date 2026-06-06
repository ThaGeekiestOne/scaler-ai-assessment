# Gemini embedding setup

Gemini handles source and query embeddings for the RAG index. Ollama still handles chat planning
and final grounded answer generation.

Set these values locally and in Vercel:

```text
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_API_KEY=<your Google AI Studio API key>
GEMINI_EMBED_MODEL=gemini-embedding-001
GEMINI_EMBED_DIMENSIONS=768
```

The app calls:

```text
POST /models/<GEMINI_EMBED_MODEL>:embedContent
```

`gemini-embedding-001` is the default because it supports retrieval-specific task types:
`RETRIEVAL_DOCUMENT` during ingestion and `RETRIEVAL_QUERY` during chat. `gemini-embedding-2`
also works, and the code formats document/query text with the task prefixes recommended for that
model.

After adding `GEMINI_API_KEY`, rebuild the knowledge index:

```bash
npm run ingest
```

Do not submit with `RAG_USE_LOCAL_FALLBACK=1`; it is only for local UI testing when the Gemini key
is unavailable.
