import type {
  ChatMessage,
  JsonObject,
  ModelClient,
  TokenUsage,
  ToolCall
} from "../model/types.js";
import type { ReplayResult } from "../replay/types.js";
import { redactedInputs } from "./catalog.js";
import type {
  AgentCapabilityCall,
  AgentEvidence,
  AgentRunSummary,
  CapabilityExecutor,
  CapabilityRegistration
} from "./types.js";

const SYSTEM_PROMPT = `You are the natural-language routing layer for the fictional Northstar training application. The tools are complete business capabilities, not individual browser actions. The deterministic harness performs all browser work and human handoff below you.

Rules:
- Choose the smallest capability that directly completes each requested business task.
- Do not call find_member before read_balance, prepare_subaccount, or simulate_subaccount; each already performs and verifies member lookup.
- Use more than one capability only when the user explicitly requests multiple business results.
- Never guess a missing required value or resolve genuinely conflicting values. Ask one concise clarification question without calling a tool.
- Minor spelling, grammar, abbreviations, and informal wording are not ambiguity when every required value is still clear.
- Use only supplied values. Do not transform account or member identifiers.
- Treat capability results as authoritative. Never invent an output or claim success after a non-success result.
- Human intervention, browser-session messages, retry, and resume are handled by the deterministic harness. Do not manage them yourself.
- After the requested capabilities finish, give a concise answer grounded in their returned fields.`;

export type AgentRunnerOptions = {
  task: string;
  model: string;
  reasoningEffort: string;
  maxTokens: number;
  maxCapabilityCalls: number;
  registrations: CapabilityRegistration[];
  modelClient: ModelClient;
  capabilityExecutor: CapabilityExecutor;
  evidence: AgentEvidence;
  startedAt?: Date;
  onProgress?: (message: string) => void;
};

function addUsage(total: Required<TokenUsage>, next?: TokenUsage): void {
  total.prompt_tokens += next?.prompt_tokens ?? 0;
  total.completion_tokens += next?.completion_tokens ?? 0;
  total.total_tokens += next?.total_tokens ?? 0;
  total.cost += next?.cost ?? 0;
}

function parseArguments(raw: string): JsonObject {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Capability arguments must be a JSON object.");
  }
  return parsed as JsonObject;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function finalContent(message: Extract<ChatMessage, { role: "assistant" }>): string | null {
  return typeof message.content === "string" && message.content.trim()
    ? message.content.trim()
    : null;
}

function modelResult(result: ReplayResult): Record<string, unknown> {
  if (result.status === "success") {
    return {
      status: result.status,
      capabilityId: result.capabilityId,
      capabilityVersion: result.capabilityVersion,
      output: result.output,
      humanHandoffs: result.humanHandoffs
    };
  }
  if (result.status === "business_outcome" || result.status === "human_required") {
    return {
      status: result.status,
      capabilityId: result.capabilityId,
      code: result.code,
      message: result.message
    };
  }
  return {
    status: result.status,
    capabilityId: result.capabilityId,
    failureKind: result.failureKind,
    ...(result.code ? { code: result.code } : {}),
    message: result.message
  };
}

function redactedCall(
  call: ToolCall,
  registrationsByName: Map<string, CapabilityRegistration>
): Record<string, unknown> {
  const registration = registrationsByName.get(call.function.name);
  try {
    const args = parseArguments(call.function.arguments);
    return {
      id: call.id,
      name: call.function.name,
      arguments: registration ? redactedInputs(registration, args) : "[UNREGISTERED]"
    };
  } catch {
    return { id: call.id, name: call.function.name, arguments: "[MALFORMED]" };
  }
}

export async function runCapabilityAgent(options: AgentRunnerOptions): Promise<AgentRunSummary> {
  const startedAt = options.startedAt ?? new Date();
  const usage: Required<TokenUsage> = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost: 0
  };
  const capabilityCalls: AgentCapabilityCall[] = [];
  const seenCalls = new Set<string>();
  const registrationsByName = new Map(
    options.registrations.map((registration) => [registration.toolName, registration])
  );
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: options.task }
  ];
  let modelTurns = 0;
  let capabilityCallCount = 0;
  let finalAnswer: string | null = null;
  let status: AgentRunSummary["status"] = "failed";
  let runError: string | undefined;
  let executionStopped = false;
  const rejectCall = async (
    callNumber: number,
    toolCall: ToolCall,
    reason: string
  ): Promise<void> => {
    capabilityCalls.push({
      callNumber,
      toolName: toolCall.function.name,
      status: "rejected",
      reason
    });
    await options.evidence.record("capability_rejected", {
      callNumber,
      toolName: toolCall.function.name,
      reason
    });
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: reason })
    });
  };

  try {
    while (modelTurns < options.maxCapabilityCalls + 3) {
      modelTurns += 1;
      const toolsAvailable = !executionStopped && capabilityCallCount < options.maxCapabilityCalls;
      const tools = toolsAvailable
        ? options.registrations.map((registration) => registration.modelTool)
        : [];
      options.onProgress?.(
        `Model turn ${modelTurns}; ${capabilityCallCount}/${options.maxCapabilityCalls} capability calls used.`
      );
      await options.evidence.record("model_request", {
        modelTurn: modelTurns,
        capabilityCallCount,
        offeredTools: tools.map((tool) => tool.function.name)
      });
      const response = await options.modelClient.complete({
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        maxTokens: options.maxTokens,
        messages,
        tools,
        sessionId: options.evidence.runId
      });
      addUsage(usage, response.usage);
      messages.push(response.message);
      const requestedCalls = response.message.tool_calls ?? [];
      await options.evidence.record("model_response", {
        modelTurn: modelTurns,
        id: response.id,
        model: response.model,
        finishReason: response.finishReason,
        usage: response.usage,
        content: finalContent(response.message),
        toolCalls: requestedCalls.map((call) => redactedCall(call, registrationsByName))
      });

      if (requestedCalls.length === 0) {
        finalAnswer = finalContent(response.message);
        if (!finalAnswer) throw new Error("The model stopped without an answer or capability call.");
        status = "completed";
        break;
      }
      if (!toolsAvailable) {
        status = "call_limit";
        runError = `The model requested another capability after the ${options.maxCapabilityCalls}-call limit or a terminal result.`;
        break;
      }

      for (const toolCall of requestedCalls) {
        capabilityCallCount += 1;
        const callNumber = capabilityCallCount;
        if (executionStopped) {
          await rejectCall(callNumber, toolCall, "execution_stopped_after_terminal_result");
          continue;
        }
        if (callNumber > options.maxCapabilityCalls) {
          await rejectCall(callNumber, toolCall, "agent_call_limit_exceeded");
          executionStopped = true;
          continue;
        }

        const registration = registrationsByName.get(toolCall.function.name);
        if (!registration) {
          const reason = "unknown_capability";
          await rejectCall(callNumber, toolCall, reason);
          continue;
        }

        let args: JsonObject;
        try {
          args = parseArguments(toolCall.function.arguments);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await rejectCall(callNumber, toolCall, reason);
          continue;
        }

        const signature = `${registration.toolName}:${canonical(args)}`;
        if (seenCalls.has(signature)) {
          await rejectCall(callNumber, toolCall, "duplicate_capability_call");
          continue;
        }
        seenCalls.add(signature);
        options.onProgress?.(`Capability ${callNumber}: ${registration.toolName}`);
        await options.evidence.record("capability_requested", {
          callNumber,
          toolName: registration.toolName,
          artifactId: registration.artifact.id,
          arguments: redactedInputs(registration, args)
        });
        const result = await options.capabilityExecutor.execute(registration, args, callNumber);
        const callRecord: AgentCapabilityCall = {
          callNumber,
          toolName: registration.toolName,
          status: result.status,
          runId: result.runId,
          ...(result.status === "business_outcome" || result.status === "human_required"
            ? { code: result.code }
            : result.status === "failure" && result.code
              ? { code: result.code }
              : {})
        };
        capabilityCalls.push(callRecord);
        await options.evidence.record("capability_completed", {
          ...callRecord,
          result: modelResult(result)
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(modelResult(result))
        });
        if (result.status !== "success") executionStopped = true;
      }
    }
    if (status === "failed" && !runError) {
      status = "call_limit";
      runError = "The model did not finish within the bounded orchestration loop.";
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    await options.evidence.record("agent_exception", { error: runError });
    status = "failed";
  }

  const finishedAt = new Date();
  const summary: AgentRunSummary = {
    runId: options.evidence.runId,
    status,
    model: options.model,
    finalAnswer,
    modelTurns,
    capabilityCallCount,
    capabilityCalls,
    usage,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    ...(runError ? { error: runError } : {})
  };
  await options.evidence.finish(summary);
  return summary;
}
