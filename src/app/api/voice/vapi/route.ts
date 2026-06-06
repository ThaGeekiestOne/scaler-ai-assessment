import { NextRequest, NextResponse } from "next/server";
import { bookInterview, findOpenSlots } from "@/lib/calendar";
import { requireSharedSecret } from "@/lib/service-auth";

export const runtime = "nodejs";

type ToolCall = {
  id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
  parameters?: Record<string, unknown>;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

export async function GET() {
  return NextResponse.json({
    status: "ok",
    tools: ["checkAvailability", "bookInterview"],
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSharedSecret(request, "VOICE_WEBHOOK_SECRET");
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const toolCalls = extractToolCalls(body);

    if (toolCalls.length === 0) {
      return NextResponse.json({
        message:
          "Voice webhook is reachable. Send tool calls named checkAvailability or bookInterview.",
      });
    }

    const results = [];

    for (const call of toolCalls) {
      const name = call.function?.name || call.name || request.nextUrl.searchParams.get("tool") || "";
      const args = {
        ...parseArguments(call.function?.arguments),
        ...parseArguments(call.arguments),
        ...(call.parameters || {}),
      };

      if (name === "checkAvailability") {
        try {
          const day = normalizeDay(args);
          const slots = await findOpenSlots(day, Number(args.durationMinutes || 30));
          results.push({
            toolCallId: call.id,
            result:
              slots.length > 0
                ? {
                    slots,
                    message: `Found ${slots.length} available slots for ${day}. Ask the caller to choose one before booking.`,
                  }
                : {
                    slots: [],
                    message: `No open slots were found for ${day}. Ask for another date.`,
                  },
          });
        } catch (error) {
          results.push({
            toolCallId: call.id,
            result: {
              error: error instanceof Error ? error.message : "Could not check availability.",
            },
          });
        }
        continue;
      }

      if (name === "bookInterview") {
        try {
          const bookingInput = normalizeBooking(args);
          const booking = await bookInterview(bookingInput);
          results.push({
            toolCallId: call.id,
            result: {
              booking,
              message: `Interview booked from ${booking.start} to ${booking.end}. A calendar invite was sent to ${bookingInput.guestEmail}.`,
            },
          });
        } catch (error) {
          results.push({
            toolCallId: call.id,
            result: {
              error: error instanceof Error ? error.message : "Could not book the interview.",
            },
          });
        }
        continue;
      }

      results.push({
        toolCallId: call.id,
        result: { error: `Unknown tool: ${name}` },
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voice webhook failed." },
      { status: 400 },
    );
  }
}

function normalizeDay(args: Record<string, unknown>) {
  const raw = String(
    args.day ||
      args.date ||
      args.preferredDate ||
      args.interviewDate ||
      args.requestedDate ||
      "",
  ).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower === "today") return offsetDate(0);
  if (lower === "tomorrow") return offsetDate(1);

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  throw new Error("Please provide the interview date as YYYY-MM-DD, today, or tomorrow.");
}

function normalizeBooking(args: Record<string, unknown>) {
  const guestName = String(args.guestName || args.name || args.callerName || "").trim();
  const guestEmail = normalizeEmail(String(args.guestEmail || args.email || args.callerEmail || "").trim());
  let start = String(args.start || args.startTime || args.dateTime || "").trim();
  let end = String(args.end || args.endTime || "").trim();

  if (!start) {
    const day = normalizeDay(args);
    const time = normalizeTime(
      String(args.time || args.preferredTime || args.interviewTime || args.slot || "").trim(),
    );
    start = `${day}T${time}:00+05:30`;
  }

  if (!end) {
    end = addMinutes(start, Number(args.durationMinutes || 30));
  }

  return {
    start,
    end,
    guestName,
    guestEmail,
    summary: args.summary ? String(args.summary) : undefined,
  };
}

function normalizeTime(raw: string) {
  const lower = raw
    .toLowerCase()
    .replace(/\bfive\b/g, "5")
    .replace(/\bfour\b/g, "4")
    .replace(/\bthree\b/g, "3")
    .replace(/\btwo\b/g, "2")
    .replace(/\bone\b/g, "1")
    .replace(/\btwelve\b/g, "12")
    .replace(/\beleven\b/g, "11")
    .replace(/\bten\b/g, "10")
    .replace(/\bnine\b/g, "9")
    .replace(/\beight\b/g, "8")
    .replace(/\bseven\b/g, "7")
    .replace(/\bsix\b/g, "6");
  const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);

  if (!match) {
    throw new Error("Please provide a preferred interview time, for example 17:00 or 5 PM.");
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) throw new Error("Interview time is invalid.");

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeEmail(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "");
}

function offsetDate(days: number) {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  istNow.setUTCDate(istNow.getUTCDate() + days);
  return istNow.toISOString().slice(0, 10);
}

function addMinutes(start: string, minutes: number) {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Interview start time must be a valid ISO datetime.");
  }
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function extractToolCalls(body: unknown): ToolCall[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const directCalls = record.toolCalls;
  const messageCalls =
    typeof record.message === "object" && record.message !== null
      ? (record.message as Record<string, unknown>).toolCalls
      : undefined;
  const messageCallList =
    typeof record.message === "object" && record.message !== null
      ? (record.message as Record<string, unknown>).toolCallList
      : undefined;
  const messageSingleCall =
    typeof record.message === "object" && record.message !== null
      ? (record.message as Record<string, unknown>).toolCall
      : undefined;

  if (Array.isArray(directCalls)) return directCalls as ToolCall[];
  if (Array.isArray(messageCalls)) return messageCalls as ToolCall[];
  if (Array.isArray(messageCallList)) return messageCallList as ToolCall[];
  if (messageSingleCall && typeof messageSingleCall === "object") return [messageSingleCall as ToolCall];
  return [];
}

function parseArguments(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
