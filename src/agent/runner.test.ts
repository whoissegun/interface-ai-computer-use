import assert from "node:assert/strict";
import test from "node:test";
import type { ModelClient, ModelRequest, ModelResponse, ToolCall } from "../model/types.js";
import type { ReplayResult } from "../replay/types.js";
import { loadCapabilityCatalog } from "./catalog.js";
import { runCapabilityAgent } from "./runner.js";
import type {
  AgentEvidence,
  AgentRunSummary,
  CapabilityExecutor,
  CapabilityRegistration
} from "./types.js";

function call(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function modelResponse(options: {
  content?: string | null;
  calls?: ToolCall[];
}): ModelResponse {
  return {
    id: "response",
    model: "fake-router",
    message: {
      role: "assistant",
      content: options.content ?? null,
      ...(options.calls ? { tool_calls: options.calls } : {})
    },
    finishReason: options.calls ? "tool_calls" : "stop"
  };
}

class FakeModel implements ModelClient {
  requests: ModelRequest[] = [];
  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake model response remains.");
    return response;
  }
}

class FakeExecutor implements CapabilityExecutor {
  calls: Array<{ registration: CapabilityRegistration; inputs: Record<string, unknown> }> = [];
  constructor(private readonly statuses: ReplayResult["status"][] = []) {}

  async execute(registration: CapabilityRegistration, inputs: Record<string, unknown>) {
    this.calls.push({ registration, inputs });
    const base = {
      runId: `replay-${this.calls.length}`,
      capabilityId: registration.artifact.id,
      capabilityVersion: registration.artifact.version,
      startedAt: "2026-09-14T00:00:00.000Z",
      finishedAt: "2026-09-14T00:00:01.000Z",
      elapsedMs: 1000,
      completedSteps: [],
      recoveries: [],
      humanHandoffs: []
    };
    const status = this.statuses.shift() ?? "success";
    if (status === "business_outcome") {
      return {
        ...base,
        status,
        code: "N04",
        message: "Member not found.",
        stepId: "verify_completion"
      } satisfies ReplayResult;
    }
    return {
      ...base,
      status: "success",
      output: inputs as Record<string, string | number | boolean>
    } satisfies ReplayResult;
  }
}

class MemoryEvidence implements AgentEvidence {
  readonly runId = "agent-test";
  readonly runDirectory = "/tmp/agent-test";
  events: Array<{ type: string; data: unknown }> = [];
  summary: AgentRunSummary | undefined;

  async record(type: string, data: unknown): Promise<void> {
    this.events.push({ type, data });
  }

  async finish(summary: AgentRunSummary): Promise<void> {
    this.summary = summary;
  }
}

async function run(options: {
  responses: ModelResponse[];
  registrations: CapabilityRegistration[];
  executor?: FakeExecutor;
  maxCapabilityCalls?: number;
}) {
  const model = new FakeModel(options.responses);
  const executor = options.executor ?? new FakeExecutor();
  const evidence = new MemoryEvidence();
  const summary = await runCapabilityAgent({
    task: "test task",
    model: "fake-router",
    reasoningEffort: "low",
    maxTokens: 1000,
    maxCapabilityCalls: options.maxCapabilityCalls ?? 3,
    registrations: options.registrations,
    modelClient: model,
    capabilityExecutor: executor,
    evidence
  });
  return { summary, model, executor, evidence };
}

test("catalog exposes only high-level capabilities and gates the risky one", async () => {
  const safe = await loadCapabilityCatalog({ includeRisky: false });
  assert.deepEqual(
    safe.map((registration) => registration.toolName),
    ["find_member", "read_balance", "prepare_subaccount"]
  );
  assert.equal(
    safe.some((registration) => registration.modelTool.function.name.startsWith("browser_")),
    false
  );
  const approved = await loadCapabilityCatalog({ includeRisky: true });
  assert.equal(approved.at(-1)?.toolName, "simulate_subaccount");
  const balance = approved.find((registration) => registration.toolName === "read_balance");
  assert.deepEqual(balance?.modelTool.function.parameters.required, [
    "memberNumber",
    "accountNumber"
  ]);
});

test("one capability call is returned to the model for a grounded final answer", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const { summary, executor } = await run({
    registrations,
    responses: [
      modelResponse({ calls: [call("one", "find_member", { memberNumber: "100042" })] }),
      modelResponse({ content: "The member is Avery Example." })
    ]
  });
  assert.equal(summary.status, "completed");
  assert.equal(summary.capabilityCallCount, 1);
  assert.equal(executor.calls.length, 1);
  assert.equal(summary.finalAnswer, "The member is Avery Example.");
});

test("a chained request can execute two different capabilities", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const { summary, executor } = await run({
    registrations,
    responses: [
      modelResponse({
        calls: [
          call("one", "read_balance", {
            memberNumber: "100042",
            accountNumber: "S-0042-01"
          })
        ]
      }),
      modelResponse({
        calls: [
          call("two", "prepare_subaccount", {
            memberNumber: "100042",
            product: "HOLIDAY_SAVINGS",
            nickname: "Rainy Day",
            openingDeposit: 25,
            statementDelivery: "ELECTRONIC"
          })
        ]
      }),
      modelResponse({ content: "The balance was read and the draft reached review." })
    ]
  });
  assert.equal(summary.status, "completed");
  assert.deepEqual(
    executor.calls.map((entry) => entry.registration.toolName),
    ["read_balance", "prepare_subaccount"]
  );
});

test("an ambiguous request can ask for clarification without browser work", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const { summary, executor } = await run({
    registrations,
    responses: [modelResponse({ content: "Which account number should I check?" })]
  });
  assert.equal(summary.status, "completed");
  assert.equal(summary.capabilityCallCount, 0);
  assert.equal(executor.calls.length, 0);
});

test("identical capability calls are rejected as duplicates", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const repeated = { memberNumber: "100042" };
  const { summary, executor } = await run({
    registrations,
    responses: [
      modelResponse({ calls: [call("one", "find_member", repeated)] }),
      modelResponse({ calls: [call("two", "find_member", repeated)] }),
      modelResponse({ content: "I already completed that lookup." })
    ]
  });
  assert.equal(executor.calls.length, 1);
  assert.equal(summary.capabilityCalls[1]?.status, "rejected");
  assert.equal(summary.capabilityCalls[1]?.reason, "duplicate_capability_call");
});

test("a fourth-style request is impossible after the configured call ceiling", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const { summary, model } = await run({
    registrations,
    maxCapabilityCalls: 1,
    responses: [
      modelResponse({ calls: [call("one", "find_member", { memberNumber: "100042" })] }),
      modelResponse({ calls: [call("two", "find_member", { memberNumber: "100099" })] })
    ]
  });
  assert.equal(summary.status, "call_limit");
  assert.deepEqual(model.requests[1]?.tools, []);
});

test("a non-success result removes all tools before the model summarizes", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const executor = new FakeExecutor(["business_outcome"]);
  const { summary, model } = await run({
    registrations,
    executor,
    responses: [
      modelResponse({ calls: [call("one", "find_member", { memberNumber: "999999" })] }),
      modelResponse({ content: "No matching member was found." })
    ]
  });
  assert.equal(summary.status, "completed");
  assert.deepEqual(model.requests[1]?.tools, []);
  assert.equal(executor.calls.length, 1);
});

test("a terminal result stops later calls returned in the same model turn", async () => {
  const registrations = await loadCapabilityCatalog({ includeRisky: false });
  const executor = new FakeExecutor(["business_outcome"]);
  const { summary } = await run({
    registrations,
    executor,
    responses: [
      modelResponse({
        calls: [
          call("one", "find_member", { memberNumber: "999999" }),
          call("two", "find_member", { memberNumber: "100042" })
        ]
      }),
      modelResponse({ content: "The first member was not found, so execution stopped." })
    ]
  });
  assert.equal(executor.calls.length, 1);
  assert.equal(summary.capabilityCalls[0]?.status, "business_outcome");
  assert.equal(summary.capabilityCalls[1]?.status, "rejected");
  assert.equal(
    summary.capabilityCalls[1]?.reason,
    "execution_stopped_after_terminal_result"
  );
});
