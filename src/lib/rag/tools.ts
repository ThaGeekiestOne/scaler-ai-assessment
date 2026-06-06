import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { bookInterview, findOpenSlots, isCalendarWindowFree } from "@/lib/calendar";
import { fetchCommits, fetchRepoDetails } from "@/lib/rag/github-live";
import { extractRepoName, retrieveFormatted } from "@/lib/rag/retriever";

export const tools = [
  new DynamicStructuredTool({
    name: "search_resume",
    description:
      "Search the candidate's resume for education, work experience, skills, qualifications, and projects.",
    schema: z.object({
      query: z.string().describe("Natural language query about the candidate's resume"),
    }),
    func: async ({ query }: { query: string }) => retrieveFormatted(query, { source: "resume" }, 5),
  }),
  new DynamicStructuredTool({
    name: "search_github",
    description:
      "Search indexed GitHub repositories for projects, tech stacks, design decisions, README details, and implementation evidence.",
    schema: z.object({
      query: z.string().describe("Natural language query about GitHub repos or projects"),
      repo_name: z.string().optional().describe("Optional repository name to scope the search"),
    }),
    func: async ({ query, repo_name }: { query: string; repo_name?: string }) =>
      retrieveFormatted(query, { source: "github", repo: repo_name || extractRepoName(query) }, 6),
  }),
  new DynamicStructuredTool({
    name: "get_repo_details",
    description:
      "Fetch live GitHub metadata for a specific repository: language breakdown, stars, last update, description, and topics.",
    schema: z.object({
      repo_name: z.string().describe("Exact GitHub repository name, for example scaler-ai-assessment"),
    }),
    func: async ({ repo_name }: { repo_name: string }) => fetchRepoDetails(repo_name),
  }),
  new DynamicStructuredTool({
    name: "get_commit_history",
    description:
      "Fetch recent live GitHub commit messages for a repository. Use for recent work, latest commit, or implementation progression.",
    schema: z.object({
      repo_name: z.string().describe("Exact GitHub repository name"),
      keyword: z.string().optional().describe("Optional keyword to filter commits"),
    }),
    func: async ({ repo_name, keyword }: { repo_name: string; keyword?: string }) =>
      fetchCommits(repo_name, keyword),
  }),
  new DynamicStructuredTool({
    name: "check_availability",
    description:
      "Check the candidate's real Google Calendar availability. Returns open interview slots for the next 14 days.",
    schema: z.object({}),
    func: async () => checkAvailability(),
  }),
  new DynamicStructuredTool({
    name: "book_call",
    description:
      "Book a call after the user gives a name, email, and requested date/time. The slot can be ISO 8601 or a natural phrase like tomorrow 5 PM IST.",
    schema: z.object({
      name: z.string().describe("Guest name"),
      email: z.string().email().describe("Guest email"),
      slot: z.string().describe("ISO 8601 datetime selected for the interview start"),
    }),
    func: async ({ name, email, slot }: { name: string; email: string; slot: string }) => bookCall(name, email, slot),
  }),
] as const;

export type ToolName = (typeof tools)[number]["name"];

export function getToolByName(name: string) {
  return tools.find((tool) => tool.name === name);
}

async function checkAvailability() {
  const days = nextDays(14);
  const allSlots = [];

  for (const day of days) {
    const slots = await findOpenSlots(day, 30);
    allSlots.push(
      ...slots.slice(0, 4).map((slot) => ({
        day,
        start: slot.start,
        end: slot.end,
        display: `${formatIst(slot.start)} - ${formatIst(slot.end)} IST`,
      })),
    );
    if (allSlots.length >= 12) break;
  }

  if (allSlots.length === 0) return "NO_RESULTS";

  return allSlots
    .slice(0, 12)
    .map((slot) => `SLOT: ${slot.display}\nSTART_ISO: ${slot.start}\nEND_ISO: ${slot.end}`)
    .join("\n\n---\n\n");
}

async function bookCall(name: string, email: string, slot: string) {
  const start = normalizeSlot(slot);
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const isFree = await isCalendarWindowFree(start, end);

  if (!isFree) {
    const alternatives = await findOpenSlots(start.slice(0, 10), 30);
    return [
      "REQUESTED_SLOT_BUSY",
      `Requested: ${formatIst(start)} IST`,
      "The requested time is already occupied on the calendar.",
      alternatives.length > 0 ? "Available alternatives on the same day:" : "",
      ...alternatives.slice(0, 4).map((alternative) => `- ${formatIst(alternative.start)} IST (${alternative.start})`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const booking = await bookInterview({
    start,
    end,
    guestName: name,
    guestEmail: email,
    summary: "Scaler AI Engineer Intern Interview",
  });

  return [
    "BOOKING_CONFIRMED",
    `Guest: ${name} <${email}>`,
    `Start: ${booking.start || start}`,
    `End: ${booking.end || end}`,
    booking.htmlLink ? `Calendar link: ${booking.htmlLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function nextDays(count: number) {
  const days: string[] = [];
  const now = new Date();

  for (let offset = 0; offset < count; offset += 1) {
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    istNow.setUTCDate(istNow.getUTCDate() + offset);
    days.push(istNow.toISOString().slice(0, 10));
  }

  return days;
}

function normalizeSlot(slot: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(slot)) {
    return slot;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(slot)) {
    return `${slot.replace(/:$/, "")}${slot.length === 16 ? ":00" : ""}+05:30`;
  }

  const naturalSlot = parseNaturalSlot(slot);
  if (naturalSlot) return naturalSlot;

  const parsed = new Date(slot);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("slot must be a valid ISO 8601 datetime.");
  }

  return parsed.toISOString();
}

function parseNaturalSlot(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/\bat\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const timeMatches = [...normalized.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)];
  const time = timeMatches[timeMatches.length - 1];
  if (!time) return "";

  let date = resolveNaturalDate(normalized);
  if (!date) {
    const isoDate = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (isoDate) {
      date = {
        year: Number(isoDate[1]),
        month: Number(isoDate[2]),
        day: Number(isoDate[3]),
      };
    }
  }

  if (!date) return "";

  let hour = Number(time[1]);
  const minute = Number(time[2] || "0");
  const meridiem = time[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour < 8) hour += 12;
  if (hour > 23 || minute > 59) return "";

  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(hour)}:${pad(minute)}:00+05:30`;
}

function resolveNaturalDate(value: string) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const base = {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
  };

  if (/\btoday\b/.test(value)) return base;
  if (/\btomorrow\b/.test(value)) return addDays(base, 1);

  const slashDate = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (slashDate) {
    return {
      year: slashDate[3] ? Number(slashDate[3]) : base.year,
      month: Number(slashDate[2]),
      day: Number(slashDate[1]),
    };
  }

  const namedMonth = value.match(
    /\b(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/,
  );
  if (namedMonth) {
    return {
      year: base.year,
      month: monthNumber(namedMonth[2]),
      day: Number(namedMonth[1]),
    };
  }

  return null;
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function monthNumber(value: string) {
  return {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }[value] || 0;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatIst(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
