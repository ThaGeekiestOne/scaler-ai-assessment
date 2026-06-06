import { NextRequest, NextResponse } from "next/server";
import { runChatAgent, type ChatTurn } from "@/lib/rag";

export const runtime = "nodejs";

const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1_200;

export async function POST(request: NextRequest) {
  let body: { messages?: ChatTurn[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = sanitizeMessages(body.messages || []);
  if (messages.length === 0) {
    return NextResponse.json({ error: "At least one message is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await runChatAgent(messages, {
          onToolStart(event) {
            send({ type: "tool_start", tool: event.tool, input: event.input });
          },
          onToolEnd(event) {
            send({ type: "tool_end", tool: event.tool });
          },
        });

        send({
          type: "answer",
          content: result.answer,
          sources: result.sources,
          trace: result.trace,
        });
      } catch (error) {
        const isMissingIndex =
          error instanceof Error &&
          (error.message.includes("ENOENT") || error.message.includes("knowledge-index"));

        send({
          type: "error",
          content: isMissingIndex
            ? "Knowledge index not found. Add real sources and run npm run ingest."
            : "Unable to answer from the knowledge base.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function sanitizeMessages(messages: ChatTurn[]) {
  return messages
    .filter((message) => {
      return (
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      );
    })
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_MESSAGE_LENGTH),
    }));
}
