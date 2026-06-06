# Ollama Cloud setup

Create an Ollama API key for chat, routing, and grounded answer synthesis:

```text
OLLAMA_API_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=<your key>
OLLAMA_CHAT_MODEL=gpt-oss:120b
```

The app uses Ollama's native chat endpoint:

- `POST /chat` for routing, normal conversation, and grounded RAG answer synthesis

Embeddings are generated with Gemini, not Ollama. After both provider env vars are set, run:

```bash
npm run ingest
```

The embedding provider, model, and dimensions used during ingestion must match the query-time
settings, because stored source vectors and query vectors need the same embedding space.

For offline development only, set `RAG_USE_LOCAL_FALLBACK=1`. That uses a simple local hashing
embedding and extractive answers, so it is useful for UI testing but not for the final submission.
