const GEMINI_API_BASE_URL = (process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(
  /\/$/,
  "",
);
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

export const GEMINI_EMBEDDING_PREFIX = "gemini:";
export const DEFAULT_GEMINI_EMBED_DIMENSIONS = readPositiveInteger(
  process.env.GEMINI_EMBED_DIMENSIONS,
  768,
);

export type GeminiEmbeddingPurpose = "document" | "query";

export function getConfiguredGeminiEmbeddingModel() {
  return `${GEMINI_EMBEDDING_PREFIX}${normalizeGeminiModelName(GEMINI_EMBED_MODEL)}`;
}

export function isGeminiEmbeddingModel(model: string) {
  return model.startsWith(GEMINI_EMBEDDING_PREFIX);
}

export async function embedWithGemini({
  text,
  model = GEMINI_EMBED_MODEL,
  dimensions = DEFAULT_GEMINI_EMBED_DIMENSIONS,
  purpose = "query",
}: {
  text: string;
  model?: string;
  dimensions?: number;
  purpose?: GeminiEmbeddingPurpose;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini embeddings. Set it and rebuild the knowledge index.");
  }

  const modelName = normalizeGeminiModelName(model);
  const response = await fetch(`${GEMINI_API_BASE_URL}/models/${modelName}:embedContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: `models/${modelName}`,
      content: {
        parts: [{ text: prepareGeminiEmbeddingText(text, modelName, purpose) }],
      },
      ...(modelName === "gemini-embedding-001" ? { taskType: purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY" } : {}),
      ...(dimensions > 0 ? { output_dimensionality: dimensions } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${await safeErrorText(response)}`);
  }

  const data = await response.json();
  const embedding = extractEmbedding(data);
  if (!embedding) {
    throw new Error("Gemini embedding response did not include an embedding vector.");
  }

  return embedding;
}

export function normalizeGeminiModelName(model: string) {
  return model.replace(GEMINI_EMBEDDING_PREFIX, "").replace(/^models\//, "").trim();
}

function prepareGeminiEmbeddingText(text: string, modelName: string, purpose: GeminiEmbeddingPurpose) {
  if (modelName !== "gemini-embedding-2") {
    return text;
  }

  if (purpose === "document") {
    return text.startsWith("title: ") ? text : `title: none | text: ${text}`;
  }

  return text.startsWith("task: ") ? text : `task: question answering | query: ${text}`;
}

function extractEmbedding(data: unknown) {
  if (!isRecord(data)) return null;

  const embedding = data.embedding;
  if (isRecord(embedding) && isNumberArray(embedding.values)) return embedding.values;
  if (isNumberArray(embedding)) return embedding;

  const embeddings = data.embeddings;
  if (Array.isArray(embeddings)) {
    const first = embeddings[0];
    if (isRecord(first) && isNumberArray(first.values)) return first.values;
    if (isNumberArray(first)) return first;
  }

  return null;
}

async function safeErrorText(response: Response) {
  const text = await response.text().catch(() => "");
  return text.slice(0, 600) || `${response.status} ${response.statusText}`;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}
