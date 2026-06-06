const DEFAULT_GITHUB_USERNAME = "ThaGeekiestOne";

export async function fetchRepoDetails(repoName: string) {
  const owner = process.env.GITHUB_USERNAME || DEFAULT_GITHUB_USERNAME;
  const repo = normalizeRepoName(repoName);
  if (!repo) return "Could not fetch repo: missing repository name.";

  const [repoResponse, languagesResponse] = await Promise.all([
    github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
    github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`),
  ]);

  if (!repoResponse.ok) return `Could not fetch repo: ${repo}`;

  const data = await repoResponse.json();
  const languages = languagesResponse.ok ? await languagesResponse.json() : {};

  return [
    `Repository: ${data.full_name || `${owner}/${repo}`}`,
    `Description: ${data.description || "No description set"}`,
    `Primary language: ${data.language || "not set"}`,
    `Language breakdown: ${formatRecord(languages) || "not available"}`,
    `Topics: ${Array.isArray(data.topics) && data.topics.length > 0 ? data.topics.join(", ") : "none"}`,
    `Stars: ${data.stargazers_count ?? 0}`,
    `Open issues: ${data.open_issues_count ?? 0}`,
    `Last updated: ${data.updated_at || "unknown"}`,
    `URL: ${data.html_url || ""}`,
  ].join("\n");
}

export async function fetchCommits(repoName: string, keyword?: string) {
  const owner = process.env.GITHUB_USERNAME || DEFAULT_GITHUB_USERNAME;
  const repo = normalizeRepoName(repoName);
  if (!repo) return "Could not fetch commits: missing repository name.";

  const response = await github(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=30`,
  );

  if (!response.ok) return `Could not fetch commits for: ${repo}`;

  const commits = await response.json();
  if (!Array.isArray(commits)) return `Could not fetch commits for: ${repo}`;

  const normalizedKeyword = keyword?.toLowerCase().trim() || "";
  const messages = commits
    .map((entry) => {
      const date = String(entry.commit?.committer?.date || entry.commit?.author?.date || "unknown").slice(0, 10);
      const message = String(entry.commit?.message || "").split("\n")[0].slice(0, 180);
      const sha = String(entry.sha || "").slice(0, 7);
      return `${date} ${sha}: ${message}`.trim();
    })
    .filter((message) => !normalizedKeyword || message.toLowerCase().includes(normalizedKeyword));

  return messages.length > 0 ? messages.join("\n") : "No matching commits found.";
}

function github(url: string) {
  return fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
  });
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function normalizeRepoName(repoName: string) {
  return repoName
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^ThaGeekiestOne\//i, "")
    .replace(/\.git$/i, "")
    .trim();
}

function formatRecord(value: Record<string, unknown>) {
  return Object.entries(value)
    .map(([key, entryValue]) => `${key} ${entryValue}`)
    .join(", ");
}
