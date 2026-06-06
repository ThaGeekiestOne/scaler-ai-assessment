export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OllamaChatOptions = {
  temperature: number;
  numPredict: number;
  format?: "json";
};

const OLLAMA_API_BASE_URL = (process.env.OLLAMA_API_BASE_URL || "https://ollama.com/api").replace(
  /\/$/,
  "",
);
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "gpt-oss:120b";

export async function callOllamaChat(messages: ChatMessage[], options: OllamaChatOptions) {
  const response = await fetch(`${OLLAMA_API_BASE_URL}/chat`, {
    method: "POST",
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: OLLAMA_CHAT_MODEL,
      messages,
      stream: false,
      ...(options.format ? { format: options.format } : {}),
      options: {
        temperature: options.temperature,
        num_predict: options.numPredict,
      },
    }),
  });

  const responseText = await response.text();
  const data = parseJson(responseText);

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${extractOllamaError(data) || responseText || response.statusText}`);
  }

  const answer = extractOllamaText(data);
  if (!answer) {
    throw new Error("Ollama chat returned an empty answer.");
  }

  return answer;
}

export function promptValueToOllamaMessages(promptValue: unknown) {
  if (isLangChainPromptValue(promptValue)) {
    return promptValue.toChatMessages().map((message) => ({
      role: langChainRoleToOllamaRole(message._getType?.() || "human"),
      content: stringifyMessageContent(message.content),
    }));
  }

  return [{ role: "user" as const, content: String(promptValue ?? "") }];
}

function ollamaHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (process.env.OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }

  return headers;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function extractOllamaText(data: unknown) {
  if (typeof data !== "object" || data === null) return "";

  const payload = data as {
    message?: { content?: unknown };
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };

  if (typeof payload.message?.content === "string") return payload.message.content.trim();
  if (typeof payload.response === "string") return payload.response.trim();

  const choice = payload.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content.trim();
  if (typeof choice?.text === "string") return choice.text.trim();

  return "";
}

function extractOllamaError(data: unknown) {
  if (typeof data !== "object" || data === null) return "";

  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}

type LangChainMessageLike = {
  _getType?: () => string;
  content?: unknown;
};

type LangChainPromptValueLike = {
  toChatMessages?: () => LangChainMessageLike[];
};

function isLangChainPromptValue(value: unknown): value is Required<LangChainPromptValueLike> {
  return (
    typeof value === "object" &&
    value !== null &&
    "toChatMessages" in value &&
    typeof (value as LangChainPromptValueLike).toChatMessages === "function"
  );
}

function langChainRoleToOllamaRole(role: string): "system" | "user" | "assistant" {
  if (role === "system") return "system";
  if (role === "ai" || role === "assistant") return "assistant";
  return "user";
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return String(content ?? "");
}
