import fs from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const username = process.env.GITHUB_USERNAME;
const token = process.env.GITHUB_TOKEN;

if (!username) {
  throw new Error("Set GITHUB_USERNAME before running this script.");
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const repos = await fetchAllRepos(username);
const publicRepos = repos
  .filter((repo) => !repo.fork && !repo.archived)
  .slice(0, repoLimit());

const records = [];

for (const repo of publicRepos) {
  const [remoteReadme, languages, recentCommits, fileProfile] = await Promise.all([
    fetchReadme(repo.full_name),
    fetchLanguages(repo.full_name),
    fetchRecentCommits(repo.full_name),
    fetchFileProfile(repo.full_name, repo.default_branch),
  ]);
  const readme = (await localReadmeOverride(repo.full_name)) || remoteReadme;

  records.push({
    name: repo.full_name,
    description: repo.description || "",
    html_url: repo.html_url,
    homepage: repo.homepage || "",
    topics: repo.topics || [],
    defaultBranch: repo.default_branch || "",
    pushed_at: repo.pushed_at,
    languages,
    recentCommits,
    fileProfile,
    readme,
    codeSummary:
      "Repository evidence is built from public README content, language breakdown, topics, description, file profile, and recent commit messages.",
  });
}

const outputPath = path.join(process.cwd(), "data", "sources", "github-repos.json");
await fs.writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Wrote ${records.length} repositories -> ${path.relative(process.cwd(), outputPath)}`);

async function fetchReadme(fullName) {
  const url = `https://api.github.com/repos/${fullName}/readme`;
  const response = await fetch(url, { headers });

  if (response.status === 404) return "";
  if (!response.ok) {
    throw new Error(`GitHub README fetch failed for ${fullName}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content || "", "base64").toString("utf8");
  return content.slice(0, 12_000);
}

async function fetchLanguages(fullName) {
  const url = `https://api.github.com/repos/${fullName}/languages`;
  const response = await fetch(url, { headers });

  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(`GitHub languages fetch failed for ${fullName}: ${await response.text()}`);
  }

  return response.json();
}

async function fetchRecentCommits(fullName) {
  const url = `https://api.github.com/repos/${fullName}/commits?per_page=8`;
  const response = await fetch(url, { headers });

  if (response.status === 409 || response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`GitHub commits fetch failed for ${fullName}: ${await response.text()}`);
  }

  const commits = await response.json();
  if (!Array.isArray(commits)) return [];

  return commits.map((entry) => ({
    sha: entry.sha?.slice(0, 7),
    date: entry.commit?.committer?.date || entry.commit?.author?.date,
    message: String(entry.commit?.message || "").split("\n")[0].slice(0, 180),
    url: entry.html_url,
  }));
}

async function fetchFileProfile(fullName, defaultBranch) {
  if (!defaultBranch) return "";

  const url = `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`;
  const response = await fetch(url, { headers });

  if (response.status === 404 || response.status === 409) return "";
  if (!response.ok) {
    throw new Error(`GitHub tree fetch failed for ${fullName}: ${await response.text()}`);
  }

  const data = await response.json();
  const files = Array.isArray(data.tree)
    ? data.tree
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => entry.path)
        .filter(isUsefulRepoPath)
    : [];
  const directories = [
    ...new Set(
      files
        .map((file) => file.split("/").slice(0, 2).join("/"))
        .filter((entry) => entry && entry.includes("/")),
    ),
  ].slice(0, 30);

  return [
    `Default branch: ${defaultBranch}`,
    `Top directories: ${directories.join(", ")}`,
    `Useful files: ${files.slice(0, 140).join(", ")}`,
  ]
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

async function localReadmeOverride(fullName) {
  if (fullName !== process.env.GITHUB_LOCAL_REPO_FULL_NAME) return "";

  try {
    return await fs.readFile(path.join(process.cwd(), "README.md"), "utf8");
  } catch {
    return "";
  }
}

async function github(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${await response.text()}`);
  }
  return response.json();
}

async function fetchAllRepos(githubUsername) {
  const allRepos = [];
  let page = 1;

  while (true) {
    const pageRepos = await github(
      `https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?per_page=100&sort=updated&page=${page}`,
    );

    if (!Array.isArray(pageRepos) || pageRepos.length === 0) break;
    allRepos.push(...pageRepos);
    if (pageRepos.length < 100) break;
    page += 1;
  }

  return allRepos;
}

function repoLimit() {
  const configured = Number(process.env.GITHUB_REPO_LIMIT || "0");
  return configured > 0 ? configured : undefined;
}

function isUsefulRepoPath(filePath) {
  const normalized = filePath.toLowerCase();
  if (
    /(^|\/)(node_modules|\.next|dist|build|coverage|\.venv|venv|__pycache__|\.git|\.vercel|target|out)\//.test(
      normalized,
    )
  ) {
    return false;
  }

  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|7z|mp4|mov|wav|mp3|ttf|woff|woff2)$/i.test(filePath)) {
    return false;
  }

  if (/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(filePath)) {
    return false;
  }

  return /\.(md|txt|json|ts|tsx|js|jsx|py|ipynb|toml|yml|yaml|css|scss|html|sql|sh|ps1|env\.example)$/i.test(filePath);
}
