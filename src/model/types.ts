export type JsonObject = Record<string, unknown>;

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | ({ role: "assistant"; content: string | null; tool_calls?: ToolCall[] } & JsonObject)
  | { role: "tool"; tool_call_id: string; content: string };

export type ModelTool = {
  type: "function";
  function: { name: string; description: string; parameters: JsonObject };
};

export type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export type ModelResponse = {
  id: string;
  model: string;
  message: Extract<ChatMessage, { role: "assistant" }>;
  finishReason: string | null;
  usage?: TokenUsage;
};

export type ModelRequest = {
  model: string;
  reasoningEffort: string;
  maxTokens: number;
  messages: ChatMessage[];
  tools: ModelTool[];
  sessionId: string;
};

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
