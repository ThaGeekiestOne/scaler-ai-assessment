# Candidate source files

Add real candidate data here before running `npm run ingest`.

Required for a strong submission:

- `resume.md`: plain-text resume content copied from the latest resume.
- `availability.md`: general interview availability, timezone, and scheduling constraints.
- `github-repos.json`: public repository metadata and README/code summaries.

`github-repos.json` can be either an array or `{ "repositories": [...] }`:

```json
[
  {
    "name": "owner/repo",
    "description": "Short repository description",
    "html_url": "https://github.com/owner/repo",
    "topics": ["nextjs", "rag"],
    "readme": "README content or a concise summary",
    "codeSummary": "What the important source files do"
  }
]
```

Do not add synthetic candidate claims. The chat route is intentionally strict and should answer
unknown when evidence is missing from these sources.
