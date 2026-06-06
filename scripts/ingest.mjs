import fs from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const root = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);

const sourcesDir = path.join(root, "data", "sources");
const outputPath = path.join(root, "data", "knowledge-index.json");
const geminiApiBaseUrl = (process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(
  /\/$/,
  "",
);
const geminiEmbeddingModel = normalizeGeminiModelName(process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001");
const embeddingModel = `gemini:${geminiEmbeddingModel}`;
const embeddingDimensions = readPositiveInteger(process.env.GEMINI_EMBED_DIMENSIONS, 768);
const useLocalFallback = process.env.RAG_USE_LOCAL_FALLBACK === "1";
const githubUsername = process.env.GITHUB_USERNAME || "ThaGeekiestOne";
const githubToken = process.env.GITHUB_TOKEN || "";
const localRepoFullName = process.env.GITHUB_LOCAL_REPO_FULL_NAME || "ThaGeekiestOne/scaler-ai-assessment";
const localModel = "local-hash-v1";
const localDimensions = 384;
let usingLocalEmbeddings = useLocalFallback;
const parentSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 3_200,
  chunkOverlap: 260,
  separators: ["\n\n", "\n", ". ", " ", ""],
});
const childSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 560,
  chunkOverlap: 110,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

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
]);

const sourceFiles = [
  { file: "resume.md", type: "resume", title: "Resume" },
  { file: "availability.md", type: "availability", title: "Availability" },
];

const docs = [];

for (const source of sourceFiles) {
  const fullPath = path.join(sourcesDir, source.file);
  if (!(await exists(fullPath))) continue;

  const raw = await fs.readFile(fullPath, "utf8");
  docs.push({
    title: source.title,
    sourceType: source.type,
    url: undefined,
    metadata: {},
    content: cleanSourceText(raw),
  });
}

docs.push(...(await fetchGitHubRepos()));

if (docs.length === 0) {
  throw new Error("No source files found. Add data/sources/resume.md, availability.md, or github-repos.json.");
}

const chunks = [];

for (const doc of docs) {
  const parentChunks = await parentChunkText(doc.content, doc.sourceType, doc.title, doc.metadata || {});

  for (const [parentIndex, parent] of parentChunks.entries()) {
    const childChunks = await childChunkText(parent.content, doc.sourceType);
    const parentId = `${slug(doc.title)}-p${parentIndex + 1}`;
    const metadata = {
      ...(doc.metadata || {}),
      ...(parent.metadata || {}),
    };

    for (const [childIndex, content] of childChunks.entries()) {
      chunks.push({
        id: `${parentId}-c${childIndex + 1}`,
        parentId,
        title: childChunks.length > 1 ? `${parent.title} (${childIndex + 1})` : parent.title,
        parentTitle: parent.title,
        sourceType: doc.sourceType,
        url: doc.url,
        metadata,
        content,
        parentContent: parent.content,
        keywords: topKeywords(`${parent.title}\n${parent.content}`, 12),
        embedding: await embedDocument(parent.title, content),
      });
    }
  }
}

const index = {
  createdAt: new Date().toISOString(),
  embeddingModel: usingLocalEmbeddings ? localModel : embeddingModel,
  dimensions: chunks[0]?.embedding.length || 0,
  chunks,
};

await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Indexed ${chunks.length} chunks from ${docs.length} documents -> ${path.relative(root, outputPath)}`);

async function fetchGitHubRepos() {
  if (githubToken) {
    const repos = await fetchGitHubReposFromApi();
    console.log(
      `Fetched ${repos.length} public GitHub repos from ${githubUsername}: ${repos
        .map((doc) => doc.metadata.repo)
        .filter(Boolean)
        .join(", ")}`,
    );
    return repos;
  }

  const fallbackPath = path.join(sourcesDir, "github-repos.json");
  if (await exists(fallbackPath)) {
    const raw = await fs.readFile(fallbackPath, "utf8");
    return parseGithubRepos(raw, { useLocalEvidence: true });
  }

  const repoName = localRepoFullName.split("/").pop() || localRepoFullName;
  const localEvidence = await localRepoEvidence(localRepoFullName);
  if (!localEvidence.readme && !localEvidence.fileProfile) return [];

  return [
    githubDocFromRecord({
      repoName,
      fullName: localRepoFullName,
      url: `https://github.com/${localRepoFullName}`,
      description: "Local repository fallback evidence.",
      defaultBranch: "local working tree",
      readme: localEvidence.readme,
      fileProfile: localEvidence.fileProfile,
      recentCommits: [],
      metadataSource: "local-fallback",
    }),
  ];
}

async function fetchGitHubReposFromApi() {
  const repos = await githubJson(
    `https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?type=public&per_page=100`,
  );

  if (!Array.isArray(repos)) {
    throw new Error("GitHub users repos response was not an array.");
  }

  return Promise.all(
    repos.map(async (repo) => {
      const repoName = String(repo.name || "").trim();
      const fullName = String(repo.full_name || `${githubUsername}/${repoName}`).trim();
      const [readme, recentCommits] = await Promise.all([
        fetchReadme(fullName),
        fetchRecentCommits(fullName),
      ]);

      return githubDocFromRecord({
        repoName,
        fullName,
        url: repo.html_url || `https://github.com/${fullName}`,
        description: repo.description || "",
        homepage: repo.homepage || "",
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        defaultBranch: repo.default_branch || "",
        pushedAt: repo.pushed_at || "",
        primaryLanguage: repo.language || "",
        readme,
        recentCommits,
        metadataSource: "github-api",
      });
    }),
  );
}

async function fetchReadme(fullName) {
  const response = await githubFetch(`https://api.github.com/repos/${fullName}/readme`);
  if (response.status === 404) return "";
  if (!response.ok) {
    throw new Error(`GitHub README fetch failed for ${fullName}: ${(await response.text()).slice(0, 600)}`);
  }

  const data = await response.json();
  return Buffer.from(data.content || "", "base64").toString("utf8").slice(0, 16_000);
}

async function fetchRecentCommits(fullName) {
  const response = await githubFetch(`https://api.github.com/repos/${fullName}/commits?per_page=50`);
  if (response.status === 404 || response.status === 409) return [];
  if (!response.ok) {
    throw new Error(`GitHub commits fetch failed for ${fullName}: ${(await response.text()).slice(0, 600)}`);
  }

  const commits = await response.json();
  if (!Array.isArray(commits)) return [];

  return commits.map((entry) => ({
    sha: entry.sha?.slice(0, 7) || "",
    date: entry.commit?.committer?.date || entry.commit?.author?.date || "",
    message: String(entry.commit?.message || "").split("\n")[0].slice(0, 220),
    url: entry.html_url || "",
  }));
}

async function githubJson(url) {
  const response = await githubFetch(url);
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${(await response.text()).slice(0, 600)}`);
  }
  return response.json();
}

function githubFetch(url) {
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${githubToken}`,
    },
  });
}

async function parseGithubRepos(raw, { useLocalEvidence = false } = {}) {
  const parsed = JSON.parse(raw);
  const repos = Array.isArray(parsed) ? parsed : parsed.repositories;

  if (!Array.isArray(repos)) {
    throw new Error("github-repos.json must be an array or { repositories: [...] }.");
  }

  return Promise.all(repos.map(async (repo) => {
    const fullName = repo.full_name || repo.name || repo.url?.replace(/^https?:\/\/github\.com\//i, "") || "GitHub repository";
    const repoName = repo.name && !repo.name.includes("/") ? repo.name : String(fullName).split("/").pop();
    const localEvidence = useLocalEvidence ? await localRepoEvidence(fullName) : { readme: "", fileProfile: "" };
    const readme = localEvidence.readme || repo.readme || repo.readmeSummary || "";
    const profileText = localEvidence.fileProfile || repo.fileProfile || "";

    return githubDocFromRecord({
      repoName,
      fullName,
      url: repo.html_url || repo.url,
      description: repo.description || "",
      homepage: repo.homepage || "",
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      defaultBranch: repo.defaultBranch || repo.default_branch || "",
      pushedAt: repo.pushed_at || "",
      languages: repo.languages || {},
      readme,
      fileProfile: profileText,
      recentCommits: Array.isArray(repo.recentCommits) ? repo.recentCommits : [],
      codeSummary: repo.codeSummary || "",
      metadataSource: useLocalEvidence ? "github-source-fallback" : "github-source",
    });
  }));
}

function githubDocFromRecord({
  repoName,
  fullName,
  url,
  description = "",
  homepage = "",
  topics = [],
  defaultBranch = "",
  pushedAt = "",
  primaryLanguage = "",
  languages = {},
  readme = "",
  fileProfile = "",
  recentCommits = [],
  codeSummary = "",
  metadataSource,
}) {
  const safeRepoName = String(repoName || fullName?.split("/").pop() || "unknown-repo").trim();
  const safeFullName = String(fullName || `${githubUsername}/${safeRepoName}`).trim();
  const commits = recentCommits.length
    ? `Recent commits: ${recentCommits
        .map((commit) => `${commit.date || "unknown date"} - ${commit.message || ""}`)
        .join("; ")}`
    : "";
  const languageText =
    Object.keys(languages || {}).length > 0
      ? `Languages: ${formatRecord(languages)}`
      : primaryLanguage
        ? `Primary language: ${primaryLanguage}`
        : "";

  return {
    title: safeFullName,
    sourceType: "github",
    url,
    metadata: {
      repo: safeRepoName,
      repoFullName: safeFullName,
      owner: safeFullName.split("/")[0] || githubUsername,
      source: metadataSource,
    },
    content: cleanSourceText(
      [
        `Repository: ${safeRepoName}`,
        `Full name: ${safeFullName}`,
        description ? `Description: ${description}` : "",
        homepage ? `Homepage: ${homepage}` : "",
        Array.isArray(topics) && topics.length > 0 ? `Topics: ${topics.join(", ")}` : "",
        defaultBranch ? `Default branch: ${defaultBranch}` : "",
        pushedAt ? `Last pushed: ${pushedAt}` : "",
        languageText,
        commits,
        fileProfile ? `File profile:\n${fileProfile}` : "",
        readme ? `README:\n${readme}` : "",
        codeSummary,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
  };
}

async function localRepoEvidence(repoName) {
  const localRepoName = localRepoFullName.split("/").pop();
  if (repoName !== localRepoFullName && repoName !== localRepoName) {
    return { readme: "", fileProfile: "" };
  }

  const [readme, files] = await Promise.all([
    fs.readFile(path.join(root, "README.md"), "utf8").catch(() => ""),
    collectLocalRepoFiles(root),
  ]);

  return {
    readme,
    fileProfile: [
      "Default branch: local working tree",
      `Top directories: ${topDirectories(files).join(", ")}`,
      `Useful files: ${files.slice(0, 160).join(", ")}`,
    ]
      .filter((line) => !line.endsWith(": "))
      .join("\n"),
  };
}

async function collectLocalRepoFiles(startDir) {
  const files = [];

  async function walk(dir, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(relativePath)) continue;
        await walk(path.join(dir, entry.name), relativePath);
        continue;
      }

      if (entry.isFile() && isUsefulRepoPath(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  await walk(startDir);
  return files.sort();
}

function topDirectories(files) {
  return [
    ...new Set(
      files
        .map((file) => file.split("/").slice(0, 2).join("/"))
        .filter((entry) => entry && entry.includes("/")),
    ),
  ].slice(0, 30);
}

function shouldSkipDirectory(relativePath) {
  return /(^|\/)(node_modules|\.next|dist|build|coverage|\.venv|venv|__pycache__|\.git|\.vercel|target|out)(\/|$)/i.test(
    relativePath,
  );
}

function isUsefulRepoPath(filePath) {
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|7z|mp4|mov|wav|mp3|ttf|woff|woff2)$/i.test(filePath)) {
    return false;
  }

  if (/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(filePath)) {
    return false;
  }

  return /\.(md|txt|json|ts|tsx|js|jsx|py|ipynb|toml|yml|yaml|css|scss|html|sql|sh|ps1|env\.example)$/i.test(filePath);
}

function formatRecord(value) {
  return Object.entries(value)
    .map(([key, entryValue]) => `${key} ${entryValue}`)
    .join(", ");
}

function cleanSourceText(value) {
  return value
    .replace(/â€¢/g, "-")
    .replace(/â€“|â€”/g, "-")
    .replace(/Â·/g, "-")
    .replace(/â/g, "'")
    .replace(/â|â/g, '"')
    .replace(/\u0000/g, "");
}

async function embedDocument(title, text) {
  if (usingLocalEmbeddings) {
    return localEmbedding(text, localDimensions);
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for Gemini embeddings. Set it or use RAG_USE_LOCAL_FALLBACK=1 for local UI testing.");
  }

  const response = await fetch(`${geminiApiBaseUrl}/models/${geminiEmbeddingModel}:embedContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: `models/${geminiEmbeddingModel}`,
      content: {
        parts: [{ text: prepareGeminiDocumentText(title, text) }],
      },
      ...(geminiEmbeddingModel === "gemini-embedding-001" ? { taskType: "RETRIEVAL_DOCUMENT" } : {}),
      ...(embeddingDimensions > 0 ? { output_dimensionality: embeddingDimensions } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${(await response.text()).slice(0, 600)}`);
  }

  const data = await response.json();
  const embedding = extractEmbedding(data);
  if (!embedding) {
    throw new Error("Gemini embedding response did not include an embedding vector.");
  }

  return embedding;
}

function prepareGeminiDocumentText(title, text) {
  if (geminiEmbeddingModel !== "gemini-embedding-2") {
    return `${title}\n${text}`;
  }

  return `title: ${title || "none"} | text: ${text}`;
}

function normalizeGeminiModelName(model) {
  return model.replace(/^gemini:/, "").replace(/^models\//, "").trim();
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function extractEmbedding(data) {
  const embedding = data?.embedding;
  if (Array.isArray(embedding?.values)) return embedding.values;
  if (Array.isArray(embedding)) return embedding;

  const first = Array.isArray(data?.embeddings) ? data.embeddings[0] : null;
  if (Array.isArray(first?.values)) return first.values;
  if (Array.isArray(first)) return first;

  return null;
}

async function splitWithLangChain(splitter, text) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return [];

  return splitter.splitText(cleaned);
}

async function childChunkText(text, sourceType) {
  if (sourceType === "resume") {
    return splitByTokenWindow(text, 460, 50);
  }

  return splitWithLangChain(childSplitter, text);
}

async function parentChunkText(text, sourceType, defaultTitle, metadata = {}) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return [];

  if (sourceType === "github") {
    const repoChunks = await splitWithLangChain(parentSplitter, cleaned);
    return repoChunks.map((content, index) => ({
      title: repoChunks.length > 1 ? `${defaultTitle} section ${index + 1}` : defaultTitle,
      content,
      metadata,
    }));
  }

  if (sourceType === "resume") {
    return splitResumeIntoSections(cleaned);
  }

  const sections = normalizeParentSections(splitIntoSections(cleaned, sourceType, defaultTitle), {
    minSize: 650,
    maxSize: 3_200,
    overlap: 260,
  });
  const parents = [];

  for (const section of sections) {
    const chunks = await splitWithLangChain(parentSplitter, section.content);
    for (const [index, content] of chunks.entries()) {
      parents.push({
        title: chunks.length > 1 ? `${section.title} section ${index + 1}` : section.title,
        content,
        metadata,
      });
    }
  }

  return parents;
}

function normalizeParentSections(sections, config) {
  const merged = [];
  let current = null;

  for (const section of sections) {
    if (!current) {
      current = { ...section };
    } else if (current.content.length < config.minSize) {
      current = {
        title: `${current.title} -> ${section.title}`,
        content: `${current.content}\n\n${section.content}`.trim(),
      };
    } else {
      merged.push(current);
      current = { ...section };
    }
  }

  if (current) {
    if (current.content.length < config.minSize && merged.length > 0) {
      const previous = merged[merged.length - 1];
      merged[merged.length - 1] = {
        title: `${previous.title} -> ${current.title}`,
        content: `${previous.content}\n\n${current.content}`.trim(),
      };
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function splitResumeIntoSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let currentTitle = "INTRO";
  let currentLines = [];

  for (const line of lines) {
    const heading = resumeHeading(line);
    if (heading === "RESUME") {
      continue;
    }

    if (heading) {
      pushResumeSection(sections, currentTitle, currentLines);
      currentTitle = heading;
      currentLines = [heading];
      continue;
    }

    currentLines.push(line);
  }

  pushResumeSection(sections, currentTitle, currentLines);

  return sections.map((section) => ({
    title: `Resume -> ${section.title}`,
    content: section.content,
    metadata: {
      section: section.title,
    },
  }));
}

function pushResumeSection(sections, title, lines) {
  const content = lines.join("\n").trim();
  if (!content) return;
  sections.push({ title, content });
}

function resumeHeading(line) {
  const trimmed = line.trim();
  const markdown = trimmed.match(/^#{1,2}\s+(.+)$/);
  const heading = (markdown?.[1] || trimmed).replace(/:$/, "").trim();
  const normalized = heading.toUpperCase();
  const knownSections = new Set([
    "RESUME",
    "TECHNICAL SKILLS",
    "PROJECTS",
    "WORK EXPERIENCE",
    "EDUCATION",
    "CERTIFICATIONS",
  ]);

  return knownSections.has(normalized) ? normalized : "";
}

function splitByTokenWindow(text, chunkTokens, overlapTokens) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= chunkTokens) return [text.trim()];

  const chunks = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkTokens, tokens.length);
    chunks.push(tokens.slice(start, end).join(" "));
    if (end === tokens.length) break;
    start = Math.max(0, end - overlapTokens);
  }

  return chunks;
}

function splitIntoSections(text, sourceType, defaultTitle) {
  const lines = text.split("\n");
  const sections = [];
  let currentTitle = defaultTitle || (sourceType === "resume" ? "Resume" : "Document");
  let currentLines = [];

  const headingPattern =
    sourceType === "resume"
      ? /^(TECHNICAL SKILLS|PROJECTS|WORK EXPERIENCE|EDUCATION|CERTIFICATIONS|AYUSH SINGH)\s*$/i
      : /^(#{1,3}\s+.+|Description:|Topics:|Languages:|Recent commits:)/i;

  for (const line of lines) {
    if (headingPattern.test(line.trim()) && currentLines.join("\n").trim()) {
      sections.push({
        title: currentTitle,
        content: currentLines.join("\n").trim(),
      });
      currentTitle = line.replace(/^#{1,3}\s*/, "").replace(/:$/, "").trim() || currentTitle;
      currentLines = [line];
      continue;
    }

    if (headingPattern.test(line.trim())) {
      currentTitle = line.replace(/^#{1,3}\s*/, "").replace(/:$/, "").trim() || currentTitle;
    }

    currentLines.push(line);
  }

  if (currentLines.join("\n").trim()) {
    sections.push({
      title: currentTitle,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections.length > 0 ? sections : [{ title: currentTitle, content: text }];
}

function topKeywords(text, limit) {
  const counts = new Map();

  for (const token of tokenize(text)) {
    if (token.length < 3 || stopwords.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}


function localEmbedding(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    vector[stableHash(token) % dimensions] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
