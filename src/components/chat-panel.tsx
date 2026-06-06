"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; url?: string; score: number }>;
};

type ChatResponse = {
  answer: string;
  sources: Array<{ title: string; url?: string; score: number }>;
};

type ChatEvent =
  | { type: "tool_start"; tool: string }
  | { type: "tool_end"; tool: string }
  | { type: "answer"; content: string; sources?: Array<{ title: string; url?: string; score: number }> }
  | { type: "error"; content: string };

const starterMessages: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Ask about experience, projects, GitHub work, skills, or availability. For booking, choose any date and time that works for you and include the guest name plus email.",
  },
];

export function ChatPanel({ hasIndex }: { hasIndex: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [toolActivity, setToolActivity] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canSend = useMemo(() => input.trim().length > 1 && !isSending, [input, isSending]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isSending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setIsSending(true);
    setToolActivity("Planning next step...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as Partial<ChatResponse> & { error?: string };
        throw new Error(body.error || "The chat service is not ready.");
      }

      const finalAnswer = await readChatStream(response, (event) => {
        if (event.type === "tool_start") {
          setToolActivity(getToolLabel(event.tool));
        }
        if (event.type === "tool_end") {
          setToolActivity("Writing answer...");
        }
      });

      setMessages((current) => [...current, finalAnswer]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The chat service failed.";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: message,
          sources: [],
        },
      ]);
    } finally {
      setToolActivity("");
      setIsSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[#ded7ca] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Public RAG chat</h2>
            <p className="mt-1 text-sm text-[#6f665b]">Session history is kept in the browser.</p>
          </div>
          <span
            className={
              hasIndex
                ? "bg-[#e4f4dd] px-2.5 py-1 text-xs font-semibold text-[#24551d]"
                : "bg-[#fff2c7] px-2.5 py-1 text-xs font-semibold text-[#76520c]"
            }
          >
            {hasIndex ? "Index loaded" : "Needs ingestion"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.map((message, index) => (
          <article
            key={`${message.role}-${index}`}
            className={message.role === "user" ? "ml-auto max-w-[82%]" : "mr-auto max-w-[88%]"}
          >
            <div
              className={
                message.role === "user"
                  ? "whitespace-pre-wrap break-words bg-[#17130f] px-4 py-3 text-sm leading-6 text-white"
                  : "whitespace-pre-wrap break-words border border-[#e7decf] bg-[#fffcf6] px-4 py-3 text-sm leading-6 text-[#2d271f]"
              }
            >
              {message.content}
            </div>
            {message.sources && message.sources.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.sources.slice(0, 4).map((source) => (
                  <a
                    key={`${source.title}-${source.score}`}
                    className="border border-[#d5cab9] bg-white px-2 py-1 text-xs text-[#554b3f] hover:border-[#17130f]"
                    href={source.url || "#"}
                    target={source.url ? "_blank" : undefined}
                    rel={source.url ? "noreferrer" : undefined}
                  >
                    {shortSourceTitle(source.title)}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {isSending ? (
          <div className="mr-auto max-w-[88%] border border-[#e7decf] bg-[#fffcf6] px-4 py-3 text-sm text-[#6f665b]">
            {toolActivity || "Thinking..."}
          </div>
        ) : null}
      </div>

      <form onSubmit={sendMessage} className="shrink-0 border-t border-[#ded7ca] bg-[#fffcf6] p-4">
        <label className="block text-sm font-medium text-[#554b3f]" htmlFor="chat-message">
          Message
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <textarea
            ref={inputRef}
            id="chat-message"
            className="min-h-24 flex-1 resize-none border border-[#cdbfa9] bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-[#17130f]"
            maxLength={800}
            placeholder="Why should we hire you, or book tomorrow at 5 PM IST for Priya Sharma, priya@example.com"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="h-12 border border-[#17130f] bg-[#17130f] px-6 text-sm font-semibold text-white transition enabled:hover:bg-[#31291f] disabled:cursor-not-allowed disabled:border-[#cdbfa9] disabled:bg-[#d8cec0] disabled:text-[#756c61]"
            disabled={!canSend}
            type="submit"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function shortSourceTitle(title: string) {
  return title
    .replace(/^ThaGeekiestOne\//, "")
    .replace(/\s+section\s+\d+$/i, "")
    .replace(/\s+-\>\s+/g, " / ")
    .slice(0, 64);
}

async function readChatStream(
  response: Response,
  onEvent: (event: ChatEvent) => void,
): Promise<ChatMessage> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    const body = (await response.json()) as Partial<ChatResponse> & { error?: string };
    return {
      role: "assistant",
      content: body.answer || body.error || "I don't know based on the indexed sources.",
      sources: body.sources || [],
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer: ChatMessage | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const event = parseSseEvent(rawEvent);
      if (!event) continue;

      onEvent(event);
      if (event.type === "error") {
        throw new Error(event.content);
      }
      if (event.type === "answer") {
        answer = {
          role: "assistant",
          content: event.content || "I don't know based on the indexed sources.",
          sources: event.sources || [],
        };
      }
    }
  }

  if (!answer) {
    throw new Error("The chat service did not return an answer.");
  }

  return answer;
}

function parseSseEvent(rawEvent: string): ChatEvent | null {
  const data = rawEvent
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.replace(/^data:\s*/, "");

  if (!data) return null;

  try {
    return JSON.parse(data) as ChatEvent;
  } catch {
    return null;
  }
}

function getToolLabel(tool: string) {
  const labels: Record<string, string> = {
    search_resume: "Searching resume...",
    search_github: "Searching GitHub repos...",
    get_repo_details: "Fetching repo details...",
    get_commit_history: "Reading commit history...",
    check_availability: "Checking calendar...",
    book_call: "Booking call...",
  };

  return labels[tool] || "Using tool...";
}
