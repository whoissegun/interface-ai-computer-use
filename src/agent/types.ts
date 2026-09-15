import type { ModelTool, TokenUsage } from "../model/types.js";
import type { CapabilityArtifact, ReplayResult } from "../replay/types.js";

export type CapabilityRegistration = {
  toolName: string;
  artifactPath: string;
  artifact: CapabilityArtifact;
  modelTool: ModelTool;
};

export interface CapabilityExecutor {
  execute(
    registration: CapabilityRegistration,
    inputs: Record<string, unknown>,
    callNumber: number
  ): Promise<ReplayResult>;
}

export interface AgentEvidence {
  readonly runId: string;
  readonly runDirectory: string;
  record(type: string, data: unknown): Promise<void>;
  finish(summary: AgentRunSummary): Promise<void>;
}

export type AgentCapabilityCall = {
  callNumber: number;
  toolName: string;
  status: ReplayResult["status"] | "rejected";
  runId?: string;
  code?: string;
  reason?: string;
};

export type AgentRunSummary = {
  runId: string;
  status: "completed" | "call_limit" | "failed";
  model: string;
  finalAnswer: string | null;
  modelTurns: number;
  capabilityCallCount: number;
  capabilityCalls: AgentCapabilityCall[];
  usage: Required<TokenUsage>;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  error?: string;
};
