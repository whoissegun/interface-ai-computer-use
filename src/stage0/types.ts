import type {
  SurfaceArguments,
  SurfaceClient,
  SurfaceTool,
  SurfaceToolResult
} from "../surface/types.js";

export type JsonObject = SurfaceArguments;
export type BrowserTool = SurfaceTool;
export type BrowserToolResult = SurfaceToolResult;
export type BrowserClient = SurfaceClient;

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | ({ role: "assistant"; content: string | null; tool_calls?: ToolCall[] } & JsonObject)
  | { role: "tool"; tool_call_id: string; content: string };

export type ModelTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
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

export type Scenario = {
  id: string;
  name: string;
  prompt: string;
  expected: string;
  allowFinalSubmission: boolean;
  humanHandoff?: {
    reasonCode: string;
    triggerText: string;
    resolvedText: string;
    instructions: string;
  };
};

export type RunStatus = "completed" | "max_steps" | "failed";

export type RunSummary = {
  runId: string;
  scenarioId: string;
  status: RunStatus;
  model: string;
  finalAnswer: string | null;
  modelTurns: number;
  toolCalls: number;
  usedTools: Record<string, number>;
  usage: Required<TokenUsage>;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  humanHandoff?: {
    reasonCode: string;
    status: "resumed";
    requestedAt: string;
    resolvedAt: string;
    checks: number;
  };
  error?: string;
};
