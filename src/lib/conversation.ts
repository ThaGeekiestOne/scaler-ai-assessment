import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { callOllamaChat, promptValueToOllamaMessages } from "@/lib/ollama-chat";
import type { ChatTurn } from "@/lib/rag";

export type ChatMode = "conversation" | "retrieval";

const modePrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are a strict router for Ayush Singh's AI screening assistant.",
      "Return exactly one lowercase word: conversation or retrieval.",
      "Choose conversation for greetings, thanks, small talk, capability questions, scheduling coordination, or incomplete booking details.",
      "Choose retrieval for anything that needs Ayush's resume, GitHub repositories, README content, commit history, projects, skills, education, experience, fit for the role, technical tradeoffs, or source-backed facts.",
      "Do not answer the user. Only return the route label.",
    ].join(" "),
  ],
  ["human", "Recent conversation:\n{history}\n\nLatest user message:\n{message}\n\nRoute:"],
]);

const conversationPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are Ayush Singh's AI representative for the Scaler AI Engineer Intern screening.",
      "Handle greetings, simple coordination, and lightweight conversation naturally.",
      "You can explain that you can answer source-backed questions about Ayush, discuss GitHub projects through retrieval, and help book interview slots.",
      "Do not invent candidate facts. If the user asks for resume, project, GitHub, skills, education, work, or fit details, tell them you will check the indexed sources.",
      "Keep replies concise, warm, and professional.",
    ].join(" "),
  ],
  ["human", "Recent conversation:\n{history}\n\nUser message:\n{message}"],
]);

const modeModel = RunnableLambda.from(async (promptValue: unknown) => {
  return callOllamaChat(promptValueToOllamaMessages(promptValue), {
    temperature: 0,
    numPredict: 8,
  });
});

const conversationModel = RunnableLambda.from(async (promptValue: unknown) => {
  return callOllamaChat(promptValueToOllamaMessages(promptValue), {
    temperature: 0.3,
    numPredict: 220,
  });
});

const modeChain = RunnableSequence.from([modePrompt, modeModel, new StringOutputParser()]);

const conversationChain = RunnableSequence.from([
  conversationPrompt,
  conversationModel,
  new StringOutputParser(),
]);

export async function classifyChatMode(messages: ChatTurn[]): Promise<ChatMode> {
  const latestMessage = messages[messages.length - 1]?.content || "";

  try {
    const label = await modeChain.invoke({
      history: formatHistory(messages.slice(-8, -1)),
      message: latestMessage,
    });

    return normalizeMode(label) || fallbackChatMode(messages);
  } catch {
    return fallbackChatMode(messages);
  }
}

export async function answerConversation(messages: ChatTurn[]) {
  const latestMessage = messages[messages.length - 1]?.content || "";

  try {
    const answer = await conversationChain.invoke({
      history: formatHistory(messages.slice(-8, -1)),
      message: latestMessage,
    });

    return answer || fallbackConversationAnswer();
  } catch {
    return fallbackConversationAnswer();
  }
}

function formatHistory(messages: ChatTurn[]) {
  if (messages.length === 0) return "None";

  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n");
}

function normalizeMode(value: string): ChatMode | "" {
  const normalized = value.toLowerCase().trim();
  if (normalized === "conversation") return "conversation";
  if (normalized === "retrieval") return "retrieval";
  if (/\bretrieval\b/.test(normalized)) return "retrieval";
  if (/\bconversation\b/.test(normalized)) return "conversation";
  return "";
}

function fallbackChatMode(messages: ChatTurn[]): ChatMode {
  const latestMessage = messages[messages.length - 1]?.content || "";
  const normalized = latestMessage.toLowerCase();

  if (
    /^(hi|hello|hey|yo|namaste|thanks|thank you)\b/.test(normalized.trim()) ||
    /\b(who are you|what are you|what can you do|help me|how can you help)\b/.test(normalized)
  ) {
    return "conversation";
  }

  if (
    /\b(resume|experience|work|internship|education|certification|certifications|project|projects|github|repo|repository|repositories|readme|commit|commits|skill|skills|tech stack|stack|built|build|background|hire|fit|right person|candidate|ayush|yourself|about you|estateflow|finetuna|pdf rag|rag pdf|rag|langchain|langgraph|fastapi|voice agent|llm|fine-tun|tradeoff|trade-off|improve|differently|source|sources)\b/.test(
      normalized,
    )
  ) {
    return "retrieval";
  }

  const previousUserMessages = messages
    .slice(-5, -1)
    .filter((message) => message.role === "user")
    .map((message) => message.content.toLowerCase())
    .join("\n");
  const isFollowUp =
    /\b(it|that|this|they|those|same|project|repo|repository|github|resume)\b/.test(normalized) &&
    fallbackChatMode([{ role: "user", content: previousUserMessages }]) === "retrieval";

  return isFollowUp ? "retrieval" : "conversation";
}

function fallbackConversationAnswer() {
  return "Hi, I can chat normally, answer source-backed questions about Ayush through retrieval, and help book an interview when you share a date, time, name, and email.";
}
