# Voice agent setup

Use a hosted voice platform that provides a real PSTN number, such as Vapi, Retell, Bland AI, or
Twilio with a realtime voice stack.

## Persona prompt

You represent the candidate for Scaler's AI Engineer Intern screen. Answer only from the resume,
GitHub, and availability sources indexed by the web app. If a caller asks for unsupported facts, say
that you do not have that information and offer to discuss verified projects, skills, or scheduling.

Keep responses short enough for voice. Confirm dates, times, timezone, caller name, and caller email
before booking. Never claim an interview has been booked until the calendar tool returns success.

## Tool endpoint

Set the platform server URL to:

```text
https://your-deployment.example.com/api/voice/vapi
```

The endpoint accepts tool calls with these names:

- `checkAvailability`: `{ "day": "2026-06-06", "durationMinutes": 30 }`
- `bookInterview`: `{ "start": "...", "end": "...", "guestName": "...", "guestEmail": "..." }`

Authentication is optional. If `VOICE_WEBHOOK_SECRET` is set in the deployment, send
`Authorization: Bearer <VOICE_WEBHOOK_SECRET>` with POST requests. If the env var is absent, the
route accepts Vapi tool calls without a custom header. The route is tolerant of common Vapi-style
payloads, but the tool names and argument keys should stay exact.
