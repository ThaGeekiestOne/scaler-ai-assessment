import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_GEMINI_EMBED_DIMENSIONS,
  embedWithGemini,
  getConfiguredGeminiEmbeddingModel,
  isGeminiEmbeddingModel,
  normalizeGeminiModelName,
} from "@/lib/gemini-embedding";
import type { KnowledgeChunk, KnowledgeIndex, RetrievalFilter, RetrievedChunk } from "@/lib/rag/types";

const INDEX_PATH = path.join(process.cwd(), "data", "knowledge-index.json");
const LOCAL_EMBEDDING_MODEL = "local-hash-v1";
const LOCAL_DIMENSIONS = 384;

let cachedIndex: KnowledgeIndex | null = null;

export function loadKnowledgeIndex() {
  if (!cachedIndex) {
    cachedIndex = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as KnowledgeIndex;
  }

  return cachedIndex;
}

export async function retrieveChunks(query: string, filter: RetrievalFilter = {}, topK = 5) {
  const index = loadKnowledgeIndex();
  const queries = buildSearchQueries(query);
  const queryEmbeddings = await Promise.all(
    queries.map((entry) => embedText(entry, index.embeddingModel, index.dimensions)),
  );
  const pool = filterIndex(index.chunks, filter);
  const defaultThreshold = index.embeddingModel === LOCAL_EMBEDDING_MODEL ? "0.045" : "0.24";
  const configuredThreshold = Number(process.env.RAG_MIN_SCORE || defaultThreshold);
  const threshold =
    index.embeddingModel === LOCAL_EMBEDDING_MODEL
      ? Math.min(configuredThreshold, Number(defaultThreshold))
      : configuredThreshold;

  const candidates = pool
    .map((chunk) => ({
      ...chunk,
      score: retrievalScore(query, queries, queryEmbeddings, chunk),
    }))
    .filter((chunk) => chunk.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK * 4);

  return diversifyByParent(candidates, topK);
}

export async function retrieveFormatted(query: string, filter: RetrievalFilter = {}, topK = 5) {
  const chunks = await retrieveChunks(query, filter, topK);
  if (chunks.length === 0) return "NO_RESULTS";

  return formatChunksForTool(chunks);
}

export function formatChunksForTool(chunks: RetrievedChunk[]) {
  return chunks
    .map((chunk) => {
      const source = chunk.parentTitle || chunk.title;
      const content = compressContext(chunk.parentContent || chunk.content, 1_400);

      return [
        `SOURCE: ${source}`,
        chunk.url ? `URL: ${chunk.url}` : "",
        `TYPE: ${chunk.sourceType}`,
        `SCORE: ${chunk.score.toFixed(3)}`,
        `CONTENT: ${content}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

export async function embedText(
  text: string,
  model = getConfiguredGeminiEmbeddingModel(),
  dimensions = DEFAULT_GEMINI_EMBED_DIMENSIONS,
) {
  if (model === LOCAL_EMBEDDING_MODEL || process.env.RAG_USE_LOCAL_FALLBACK === "1") {
    return localEmbedding(text, dimensions || LOCAL_DIMENSIONS);
  }

  if (!isGeminiEmbeddingModel(model)) {
    throw new Error(
      `Unsupported embedding model "${model}". Rebuild data/knowledge-index.json with Gemini embeddings.`,
    );
  }

  return embedWithGemini({
    text,
    model: normalizeGeminiModelName(model),
    dimensions,
    purpose: "query",
  });
}

function filterIndex(chunks: KnowledgeChunk[], filter: RetrievalFilter) {
  return chunks.filter((chunk) => {
    if (filter.source && chunk.sourceType !== filter.source) return false;
    if (filter.repo && !chunkMatchesRepo(chunk, filter.repo)) return false;
    return true;
  });
}

function chunkMatchesRepo(chunk: KnowledgeChunk, repo: string) {
  const normalizedRepo = normalizeRepoName(repo);
  if (!normalizedRepo) return true;

  const title = `${chunk.parentTitle || ""}\n${chunk.title || ""}`.toLowerCase();
  const url = (chunk.url || "").toLowerCase();
  const repoSlug = normalizedRepo.split("/").pop() || normalizedRepo;

  return title.includes(normalizedRepo) || title.includes(repoSlug) || url.includes(normalizedRepo);
}

function retrievalScore(
  originalQuery: string,
  queries: string[],
  queryEmbeddings: number[][],
  chunk: KnowledgeChunk,
) {
  const vectorScore = Math.max(
    ...queryEmbeddings.map((queryEmbedding) => cosineSimilarity(queryEmbedding, chunk.embedding)),
  );
  const searchableText = [
    chunk.title,
    chunk.parentTitle,
    chunk.keywords?.join(" "),
    chunk.content,
    chunk.parentContent,
  ]
    .filter(Boolean)
    .join("\n");
  const lexicalScore = Math.max(...queries.map((entry) => lexicalSimilarity(entry, searchableText)));

  return vectorScore * 0.55 + lexicalScore * 0.35 + retrievalBoost(originalQuery, chunk);
}

function buildSearchQueries(query: string) {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();
  const queries = new Set<string>([normalized]);

  if (lower.includes("hire") || lower.includes("fit") || lower.includes("right person")) {
    queries.add("RAG voice agent LangChain FastAPI LLM retrieval projects experience");
    queries.add("AI Engineer Intern fit background skills production deployment");
  }

  if (isCandidateBackgroundQuestion(lower)) {
    queries.add("Ayush Singh technical skills projects work experience education certifications");
    queries.add("candidate background AI engineer resume projects internship skills");
  }

  if (isRepoQuestion(lower)) {
    queries.add("GitHub repositories README purpose tech stack languages recent commits design tradeoffs");
    queries.add("repository description topics languages code summary commit history");
  }

  if (lower.includes("different") || lower.includes("improve") || lower.includes("tradeoff")) {
    queries.add(`${normalized} design tradeoffs improvements limitations future work`);
  }

  for (const part of normalized.split(/\?|(?:\s+and\s+)/i)) {
    const trimmed = part.trim();
    if (trimmed.length > 8) queries.add(trimmed);
  }

  return [...queries].slice(0, 5);
}

function retrievalBoost(query: string, chunk: KnowledgeChunk) {
  const normalizedQuery = query.toLowerCase();
  const searchableText = `${chunk.title}\n${chunk.parentTitle || ""}\n${chunk.content}\n${
    chunk.parentContent || ""
  }`.toLowerCase();
  let boost = 0;

  if (isCandidateFitQuestion(normalizedQuery) && chunk.sourceType === "resume") boost += 0.22;
  if (isCandidateBackgroundQuestion(normalizedQuery) && chunk.sourceType === "resume") boost += 0.26;
  if (isRepoQuestion(normalizedQuery) && chunk.sourceType === "github") boost += 0.1;

  for (const project of ["estateflow", "pdf rag", "rag pdf", "finetuna", "sign2text"]) {
    if (normalizedQuery.includes(project) && searchableText.includes(project)) boost += 0.22;
  }

  const repo = extractRepoName(query);
  if (repo && chunkMatchesRepo(chunk, repo)) boost += 0.32;

  return boost;
}

function diversifyByParent(chunks: RetrievedChunk[], limit: number) {
  const selected: RetrievedChunk[] = [];
  const seenParents = new Set<string>();

  for (const chunk of chunks) {
    const parentKey = chunk.parentId || chunk.id;
    if (seenParents.has(parentKey)) continue;
    selected.push(chunk);
    seenParents.add(parentKey);
    if (selected.length >= limit) return selected;
  }

  for (const chunk of chunks) {
    if (selected.some((entry) => entry.id === chunk.id)) continue;
    selected.push(chunk);
    if (selected.length >= limit) break;
  }

  return selected;
}

function lexicalSimilarity(query: string, text: string) {
  const queryTokens = tokenize(query).filter((token) => !stopwords.has(token));
  if (queryTokens.length === 0) return 0;

  const normalizedText = text.toLowerCase();
  const textTokens = new Set(tokenize(text));
  const matched = queryTokens.filter((token) => textTokens.has(token));
  const coverage = matched.length / queryTokens.length;
  const density = matched.length / Math.max(12, Math.sqrt(textTokens.size));
  const phraseBoost = normalizedText.includes(query.toLowerCase()) ? 0.12 : 0;

  return Math.min(1, coverage * 0.75 + density * 0.25 + phraseBoost);
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function localEmbedding(text: string, dimensions: number) {
  const vector = new Array<number>(dimensions).fill(0);

  for (const token of tokenize(text)) {
    vector[stableHash(token) % dimensions] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function compressContext(content: string, maxLength: number) {
  const cleaned = content.replace(/\s{3,}/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;

  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let result = "";

  for (const sentence of sentences) {
    if (`${result} ${sentence}`.trim().length > maxLength) break;
    result = `${result} ${sentence}`.trim();
  }

  return result || `${cleaned.slice(0, maxLength - 3)}...`;
}

function normalizeRepoName(repo: string) {
  return repo
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^ThaGeekiestOne\//i, "")
    .replace(/\.git$/i, "")
    .trim()
    .toLowerCase();
}

export function extractRepoName(text: string) {
  const fullName = text.match(/ThaGeekiestOne\/[A-Za-z0-9_.-]+/i);
  if (fullName) return fullName[0].split("/").pop() || fullName[0];

  const known = text.match(
    /\b(realestate-crm|scaler-ai-assessment|pdf-rag-assistant|finetuna(?:-llmfinetuner)?|usedcarprediction|sign2text|estateflow)\b/i,
  );
  if (known) return known[0];

  const repoPhrase = text.match(/\b(?:repo|repository|project)\s+([A-Za-z][A-Za-z0-9_.-]{2,})\b/i);
  const candidate = repoPhrase?.[1] || "";

  return candidate && !questionWords.has(candidate.toLowerCase()) ? candidate : "";
}

function isCandidateFitQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("hire") ||
    normalizedQuestion.includes("fit") ||
    normalizedQuestion.includes("why should") ||
    normalizedQuestion.includes("good candidate") ||
    normalizedQuestion.includes("right person")
  );
}

function isCandidateBackgroundQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("tell me about yourself") ||
    normalizedQuestion.includes("about you") ||
    normalizedQuestion.includes("background") ||
    normalizedQuestion.includes("who is ayush") ||
    normalizedQuestion.includes("introduce yourself") ||
    normalizedQuestion.includes("experience") ||
    normalizedQuestion.includes("education") ||
    normalizedQuestion.includes("skills")
  );
}

function isRepoQuestion(normalizedQuery: string) {
  return (
    normalizedQuery.includes("github") ||
    normalizedQuery.includes("repo") ||
    normalizedQuery.includes("repository") ||
    normalizedQuery.includes("repositories") ||
    normalizedQuery.includes("readme") ||
    normalizedQuery.includes("commit") ||
    normalizedQuery.includes("project")
  );
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const stopwords = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "you",
  "your",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "can",
  "into",
  "using",
  "use",
  "how",
  "what",
  "why",
  "when",
  "where",
  "about",
]);

const questionWords = new Set([
  "what",
  "which",
  "where",
  "when",
  "why",
  "how",
  "repo",
  "repository",
  "project",
  "stack",
  "built",
  "use",
  "uses",
]);
