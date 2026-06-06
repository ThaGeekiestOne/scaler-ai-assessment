type CalendarConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  timeZone: string;
};

export type CalendarSlot = {
  start: string;
  end: string;
};

export type BookingRequest = {
  start: string;
  end: string;
  guestName: string;
  guestEmail: string;
  summary?: string;
};

const DEFAULT_CALENDAR_ID = "primary";
const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const DEFAULT_WORK_START = "09:00";
const DEFAULT_WORK_END = "18:00";

export function getCalendarConfig(): CalendarConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Calendar credentials are not configured.");
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: process.env.GOOGLE_CALENDAR_ID || DEFAULT_CALENDAR_ID,
    timeZone: process.env.CANDIDATE_TIME_ZONE || DEFAULT_TIME_ZONE,
  };
}

export async function findOpenSlots(dayIso: string, durationMinutes = 30) {
  const config = getCalendarConfig();
  const accessToken = await getAccessToken(config);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
    throw new Error("day must resolve to YYYY-MM-DD.");
  }

  const start = toCalendarInstant(dayIso, DEFAULT_WORK_START, config.timeZone);
  const end = toCalendarInstant(dayIso, DEFAULT_WORK_END, config.timeZone);

  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      timeZone: config.timeZone,
      items: [{ id: config.calendarId }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Calendar freeBusy failed: ${await response.text()}`);
  }

  const data = await response.json();
  const busy = data.calendars?.[config.calendarId]?.busy || [];
  return subtractBusyWindows(new Date(start), new Date(end), busy, durationMinutes).slice(0, 6);
}

export async function isCalendarWindowFree(startIso: string, endIso: string) {
  const config = getCalendarConfig();
  const accessToken = await getAccessToken(config);

  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      timeZone: config.timeZone,
      items: [{ id: config.calendarId }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Calendar freeBusy failed: ${await response.text()}`);
  }

  const data = await response.json();
  const busy = data.calendars?.[config.calendarId]?.busy || [];
  return !Array.isArray(busy) || busy.length === 0;
}

export async function bookInterview(request: BookingRequest) {
  const config = getCalendarConfig();
  const accessToken = await getAccessToken(config);

  if (!request.guestEmail || !request.guestName) {
    throw new Error("guestName and guestEmail are required to book an interview.");
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: request.summary || "Scaler AI Engineer Intern Interview",
        description: "Scheduled automatically by the candidate voice agent.",
        start: { dateTime: request.start, timeZone: config.timeZone },
        end: { dateTime: request.end, timeZone: config.timeZone },
        attendees: [{ email: request.guestEmail, displayName: request.guestName }],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Calendar booking failed: ${await response.text()}`);
  }

  const event = await response.json();
  return {
    id: event.id,
    htmlLink: event.htmlLink,
    start: event.start?.dateTime,
    end: event.end?.dateTime,
  };
}

async function getAccessToken(config: CalendarConfig) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token as string;
}

function subtractBusyWindows(
  dayStart: Date,
  dayEnd: Date,
  busy: Array<{ start: string; end: string }>,
  durationMinutes: number,
) {
  const slots: CalendarSlot[] = [];
  const durationMs = durationMinutes * 60_000;
  const busyWindows = busy
    .map((window) => ({
      start: new Date(window.start).getTime(),
      end: new Date(window.end).getTime(),
    }))
    .sort((left, right) => left.start - right.start);

  let cursor = dayStart.getTime();

  for (const window of busyWindows) {
    while (cursor + durationMs <= window.start) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + durationMs).toISOString(),
      });
      cursor += durationMs;
    }
    cursor = Math.max(cursor, window.end);
  }

  while (cursor + durationMs <= dayEnd.getTime()) {
    slots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + durationMs).toISOString(),
    });
    cursor += durationMs;
  }

  return slots;
}

function toCalendarInstant(dayIso: string, time: string, timeZone: string) {
  const offset = timeZone === "Asia/Kolkata" ? "+05:30" : "Z";
  return `${dayIso}T${time}:00${offset}`;
}
