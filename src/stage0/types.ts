import type { SurfaceClient, SurfaceTool, SurfaceToolResult } from "../surface/types.js";
import type { TokenUsage } from "../model/types.js";
export type {
  ChatMessage,
  JsonObject,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelTool,
  TokenUsage,
  ToolCall
} from "../model/types.js";

export type BrowserTool = SurfaceTool;
export type BrowserToolResult = SurfaceToolResult;
export type BrowserClient = SurfaceClient;


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
