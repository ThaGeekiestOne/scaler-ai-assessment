export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type KnowledgeChunk = {
  id: string;
  parentId?: string;
  title: string;
  parentTitle?: string;
  sourceType: "resume" | "github" | "availability" | "note";
  url?: string;
  metadata?: Record<string, string>;
  content: string;
  parentContent?: string;
  keywords?: string[];
  embedding: number[];
};

export type KnowledgeIndex = {
  createdAt: string;
  embeddingModel: string;
  dimensions: number;
  chunks: KnowledgeChunk[];
};

export type RetrievedChunk = KnowledgeChunk & {
  score: number;
};

export type RetrievalFilter = {
  source?: KnowledgeChunk["sourceType"];
  repo?: string;
};

export type ChatSource = {
  title: string;
  url?: string;
  score: number;
  tool?: string;
};

export type AgentToolEvent = {
  tool: string;
  input?: unknown;
  output?: string;
};

export type AgentCallbacks = {
  onToolStart?: (event: AgentToolEvent) => void;
  onToolEnd?: (event: AgentToolEvent) => void;
};

export type AgentToolResult = {
  tool: string;
  input: Record<string, unknown>;
  output: string;
};

export type AgentResult = {
  answer: string;
  sources: ChatSource[];
  trace: {
    iterations: number;
    toolCalls: Array<{
      tool: string;
      input: Record<string, unknown>;
    }>;
  };
};
