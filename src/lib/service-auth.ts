import { NextRequest, NextResponse } from "next/server";

type SecretName = "VOICE_WEBHOOK_SECRET";

export function requireSharedSecret(request: NextRequest, secretName: SecretName) {
  const expected = process.env[secretName];

  if (!expected) {
    return null;
  }

  const header = request.headers.get("authorization") || "";
  const customSecret =
    request.headers.get("x-vapi-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.nextUrl.searchParams.get("secret") ||
    "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (token !== expected && customSecret !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
