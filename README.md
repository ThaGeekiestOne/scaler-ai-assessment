# Scaler AI Engineer Screening Assignment

AI representative for Ayush Singh that can answer grounded questions from a resume and public
GitHub repositories, handle interview scheduling from chat, and expose voice-agent tool endpoints
for calendar booking.

## Live Submission

```text
Public chat URL: https://scaler-ai-assessment.vercel.app/
GitHub repo: https://github.com/ThaGeekiestOne/scaler-ai-assessment
Evaluation report: https://scaler-ai-assessment.vercel.app/evaluation-report.pdf
Voice agent phone number: provided in the Scaler submission form
Loom walkthrough: provided in the Scaler submission form
```

The app should remain live for the 7-day review window. Calendar booking uses the real Google
Calendar configured through OAuth refresh-token credentials.

## What It Does

- Public chat persona for questions about Ayush's background, experience, projects, skills,
  GitHub work, and availability.
- RAG-grounded answers over the actual resume and public GitHub repositories. GitHub ingestion
  reads public repo metadata, README files, and the latest 50 commit messages per repo.
- Chat-side scheduling: users can ask for availability or choose any preferred time, then the app
  checks the real calendar and books the call if the slot is free.
- Voice-agent webhook for Vapi-compatible tools: `checkAvailability` and `bookInterview`.
- Honest fallback behavior: if indexed evidence is missing, the assistant says it does not know
  instead of inventing facts.

## Architecture

```text
Caller / browser
  |
  | voice call                                  public chat
  v                                             v
Vapi assistant                           Next.js chat UI
  |                                             |
  | tool calls                                  | /api/chat SSE
  v                                             v
/api/voice/vapi                         Agentic tool loop
  |                                             |
  | checkAvailability / bookInterview           | search_resume / search_github
  v                                             | get_repo_details / get_commit_history
Google Calendar API                            | check_availability / book_call
                                                v
                                      Ollama Cloud planner + synthesis
                                                |
                                                v
                                      Gemini query embeddings
                                                |
                                                v
                                      data/knowledge-index.json
                                                ^
                                                |
                         resume.md + GitHub API repo README + commit history
                         LangChain text splitting + Gemini document embeddings
```

## RAG Grounding

`scripts/ingest.mjs` builds `data/knowledge-index.json` from:

- `data/sources/resume.md`
- public GitHub repositories from `https://api.github.com/users/ThaGeekiestOne/repos`
- each repo README from `GET /repos/{owner}/{repo}/readme`
- last 50 commit messages from `GET /repos/{owner}/{repo}/commits?per_page=50`

Each GitHub chunk stores `metadata.repo`, so repo-scoped retrieval works for questions like
"Tell me about sign2text" or "What would you improve in pdf-rag-assistant?" Resume chunks are split
by actual sections such as `WORK EXPERIENCE`, `EDUCATION`, `PROJECTS`, and `CERTIFICATIONS`.

## Voice Agent

Voice platforms should point tool calls to:

```text
https://scaler-ai-assessment.vercel.app/api/voice/vapi
```

Tools:

```text
checkAvailability
bookInterview
```

The route accepts common Vapi payloads. `VOICE_WEBHOOK_SECRET` is optional: if it is configured,
send it as `Authorization: Bearer <secret>` or `x-vapi-secret`; if it is absent, the endpoint
accepts tool calls without a custom header.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run ingest
npm run dev
```

Required environment variables:

```text
NEXT_PUBLIC_CHAT_URL
NEXT_PUBLIC_VOICE_PHONE_NUMBER

OLLAMA_API_BASE_URL
OLLAMA_API_KEY
OLLAMA_CHAT_MODEL

GEMINI_API_BASE_URL
GEMINI_API_KEY
GEMINI_EMBED_MODEL
GEMINI_EMBED_DIMENSIONS

GITHUB_USERNAME
GITHUB_TOKEN

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_CALENDAR_ID
CANDIDATE_TIME_ZONE
```

Provider split:

- Ollama Cloud handles conversation planning and final grounded answer synthesis.
- Gemini handles source and query embeddings.
- Google Calendar handles free/busy checks and event creation.
- GitHub API supplies live repo README and commit evidence during ingestion.

## Useful Commands

```bash
npm run ingest      # rebuild RAG index with Gemini embeddings
npm run lint        # run ESLint
npm run build       # production build
npm run eval:pdf    # regenerate public/evaluation-report.pdf
```

## Evaluation Report

The one-page PDF is generated at:

```text
public/evaluation-report.pdf
```

It covers voice latency/task-completion measurements, chat groundedness checks, retrieval quality,
failure modes, tradeoffs, and future improvements.

## Cost Breakdown

The implementation is designed to stay inside free or trial-tier usage for the screening window.

```text
Hosting: Vercel hobby tier
Chat session: Gemini query embeddings + one Ollama planning call + selected tool calls + one Ollama synthesis call
RAG ingestion: GitHub API calls + Gemini document embeddings when rebuilding the index
Calendar booking: Google Calendar free/busy request + event creation request
Voice call: Vapi/telephony minutes, plus Google Calendar API calls when scheduling
```

No paid database is required because the generated knowledge index is committed as a static JSON
artifact and searched in memory.

## Submission Checks

Before submitting:

```text
1. Open the public chat URL and ask "why should we hire you?"
2. Ask about a specific public repo, for example sign2text or pdf-rag-assistant
3. Ask for availability and book a real calendar event from chat
4. Place a Vapi test call and book a real calendar event through voice tools
5. Confirm /evaluation-report.pdf downloads successfully
```
