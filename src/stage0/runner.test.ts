import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EvidenceRecorder } from "./evidence.js";
import { runDiscovery } from "./runner.js";
import { getScenario } from "./scenarios.js";
import type {
  BrowserClient,
  BrowserTool,
  BrowserToolResult,
  JsonObject,
  ModelClient,
  ModelRequest,
  ModelResponse
} from "./types.js";

class FakeBrowser implements BrowserClient {
  readonly calls: Array<{ name: string; args: JsonObject }> = [];
  closed = false;

  async connect() {}

  async listTools(): Promise<BrowserTool[]> {
    return [
      {
        name: "browser_navigate",
        description: "Navigate",
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
      },
      {
        name: "browser_evaluate",
        description: "Run arbitrary JavaScript",
        inputSchema: { type: "object" }
      }
    ];
  }

  async callTool(name: string, args: JsonObject): Promise<BrowserToolResult> {
    this.calls.push({ name, args });
    return { content: [{ type: "text", text: "Member 100042 — Avery Example" }] };
  }

  async close() {
    this.closed = true;
  }
}

class FakeModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) throw new Error("Fake model has no response for this turn.");
    return response;
  }
}

function toolCallResponse(name: string, args: JsonObject): ModelResponse {
  return {
    id: "response-tool",
    model: "fake/model",
    finishReason: "tool_calls",
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name, arguments: JSON.stringify(args) }
        }
      ]
    },
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.01 }
  };
}

function finalResponse(content: string): ModelResponse {
  return {
    id: "response-final",
    model: "fake/model",
    finishReason: "stop",
    message: { role: "assistant", content },
    usage: { prompt_tokens: 14, completion_tokens: 6, total_tokens: 20, cost: 0.02 }
  };
}

test("the runner executes model-requested tools and records an inspectable result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-runner-"));
  try {
    const scenario = getScenario("a1");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: true,
      secrets: ["never-log-this"]
    });
    const browser = new FakeBrowser();
    const model = new FakeModel([
      toolCallResponse("browser_navigate", { url: "https://target-app-gamma.vercel.app/" }),
      finalResponse("Member 100042 is Avery Example.")
    ]);

    const summary = await runDiscovery({
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      maxTokens: 2000,
      modelClient: model,
      browserClient: browser,
      evidence
    });

    assert.equal(summary.status, "completed");
    assert.equal(summary.finalAnswer, "Member 100042 is Avery Example.");
    assert.deepEqual(summary.usedTools, { browser_navigate: 1 });
    assert.equal(summary.usage.total_tokens, 34);
    assert.equal(summary.usage.cost, 0.03);
    assert.equal(browser.closed, true);
    assert.equal(browser.calls.length, 1);
    assert.deepEqual(
      model.requests[0]?.tools.map((tool) => tool.function.name),
      ["browser_navigate"],
      "withheld MCP tools must not reach the model"
    );

    const events = await readFile(join(evidence.runDirectory, "events.ndjson"), "utf8");
    assert.match(events, /"type":"tool_requested"/);
    assert.match(events, /"type":"tool_result"/);
    assert.match(events, /Avery Example/);
    assert.match(
      await readFile(join(evidence.runDirectory, "discovered-tools.json"), "utf8"),
      /browser_evaluate/
    );
    assert.doesNotMatch(
      await readFile(join(evidence.runDirectory, "offered-tools.json"), "utf8"),
      /browser_evaluate/
    );
    assert.match(
      await readFile(join(evidence.runDirectory, "withheld-tools.json"), "utf8"),
      /Arbitrary page JavaScript/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a policy denial is returned to the model without invoking the browser", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-policy-"));
  try {
    const scenario = getScenario("a3");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: true
    });
    const browser = new FakeBrowser();
    browser.listTools = async () => [
      {
        name: "browser_navigate",
        inputSchema: { type: "object", properties: { url: { type: "string" } } }
      },
      {
        name: "browser_click",
        inputSchema: { type: "object" }
      }
    ];
    const model = new FakeModel([
      toolCallResponse("browser_click", { element: "SIMULATE FINAL SUBMISSION", ref: "e17" }),
      finalResponse("I stopped because submission was not authorized.")
    ]);

    const summary = await runDiscovery({
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      maxTokens: 2000,
      modelClient: model,
      browserClient: browser,
      evidence
    });

    assert.equal(summary.status, "completed");
    assert.equal(browser.calls.length, 0);
    const followup = model.requests[1]?.messages.at(-1);
    assert.equal(followup?.role, "tool");
    assert.match(followup?.content ?? "", /policyDenied/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a provider refusal is classified explicitly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-refusal-"));
  try {
    const scenario = getScenario("a1");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: true
    });
    const browser = new FakeBrowser();
    const model = new FakeModel([
      {
        id: "response-refusal",
        model: "fake/model",
        finishReason: "content_filter",
        message: { role: "assistant", content: null, refusal: "Provider policy block." }
      }
    ]);

    const summary = await runDiscovery({
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      maxTokens: 2000,
      modelClient: model,
      browserClient: browser,
      evidence
    });

    assert.equal(summary.status, "failed");
    assert.match(summary.error ?? "", /Model refused.*Provider policy block/);
    assert.equal(browser.calls.length, 0);
    assert.equal(browser.closed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a human-approved controller keeps one browser open and resumes after approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-handoff-"));
  try {
    const scenario = getScenario("x2");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: false,
      waitForHuman: true
    });
    const browser = new FakeBrowser();
    browser.listTools = async () => [
      {
        name: "browser_navigate",
        inputSchema: { type: "object", properties: { url: { type: "string" } } }
      },
      { name: "browser_snapshot", inputSchema: { type: "object" } }
    ];
    let snapshotNumber = 0;
    browser.callTool = async (name, args) => {
      assert.equal(browser.closed, false, "the browser must stay open throughout the handoff");
      browser.calls.push({ name, args });
      if (name === "browser_click") {
        return { content: [{ type: "text", text: "Supervisor acknowledgement recorded." }] };
      }
      snapshotNumber += 1;
      const text =
        snapshotNumber === 1
          ? 'HUMAN REVIEW REQUIRED — HOLD H91\nbutton "Supervisor: acknowledge review" [ref=f2e4]'
          : "REVIEW CHECKPOINT\nbutton SIMULATE FINAL SUBMISSION";
      return { content: [{ type: "text", text }] };
    };
    const model = new FakeModel([finalResponse("HOLD H91 requires a human supervisor.")]);

    const summary = await runDiscovery({
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      maxTokens: 2000,
      modelClient: model,
      browserClient: browser,
      evidence,
      liveHumanHandoff: {
        timeoutMs: 100,
        pollIntervalMs: 1,
        requestDecision: async () => "approved"
      }
    });

    assert.equal(summary.status, "completed");
    assert.equal(summary.humanHandoff?.reasonCode, "H91");
    assert.equal(summary.humanHandoff?.status, "resumed");
    assert.equal(summary.humanHandoff?.checks, 2);
    assert.equal(browser.closed, true, "the browser closes only after the resume condition is verified");
    assert.deepEqual(
      browser.calls.map((call) => call.name),
      ["browser_snapshot", "browser_click", "browser_snapshot"]
    );
    assert.deepEqual(browser.calls[1]?.args, {
      element: "Supervisor: acknowledge review",
      target: "f2e4"
    });

    const events = await readFile(join(evidence.runDirectory, "events.ndjson"), "utf8");
    assert.match(events, /"type":"human_handoff_required"/);
    assert.match(events, /"type":"human_handoff_decision"/);
    assert.match(events, /"type":"human_handoff_action_applied"/);
    assert.match(events, /"type":"human_handoff_resumed"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a direct browser handoff detects the human action without performing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-direct-handoff-"));
  try {
    const scenario = getScenario("x2");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: false,
      waitForHuman: true
    });
    const browser = new FakeBrowser();
    browser.listTools = async () => [
      {
        name: "browser_navigate",
        inputSchema: { type: "object", properties: { url: { type: "string" } } }
      },
      { name: "browser_snapshot", inputSchema: { type: "object" } }
    ];
    let snapshotNumber = 0;
    browser.callTool = async (name, args) => {
      assert.equal(browser.closed, false);
      browser.calls.push({ name, args });
      snapshotNumber += 1;
      return {
        content: [
          {
            type: "text",
            text:
              snapshotNumber === 1
                ? 'HUMAN REVIEW REQUIRED — HOLD H91\nbutton "Supervisor: acknowledge review" [ref=f2e4]'
                : "REVIEW CHECKPOINT\nbutton SIMULATE FINAL SUBMISSION"
          }
        ]
      };
    };

    const summary = await runDiscovery({
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      maxTokens: 2000,
      modelClient: new FakeModel([finalResponse("HOLD H91 requires a human supervisor.")]),
      browserClient: browser,
      evidence,
      liveHumanHandoff: { timeoutMs: 100, pollIntervalMs: 1 }
    });

    assert.equal(summary.status, "completed");
    assert.equal(summary.humanHandoff?.status, "resumed");
    assert.equal(browser.closed, true);
    assert.deepEqual(
      browser.calls.map((call) => call.name),
      ["browser_snapshot", "browser_snapshot"],
      "the harness must only observe while the human owns the browser"
    );
    const events = await readFile(join(evidence.runDirectory, "events.ndjson"), "utf8");
    assert.match(events, /"type":"human_handoff_resume_observed"/);
    assert.match(events, /"holdVisible":false/);
    assert.match(events, /"resumeVisible":true/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model-provided artifact filenames stay inside their run directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage0-artifact-"));
  try {
    const scenario = getScenario("a1");
    const evidence = await EvidenceRecorder.create({
      rootDirectory: directory,
      scenario,
      targetUrl: "https://target-app-gamma.vercel.app/",
      model: "fake/model",
      reasoningEffort: "high",
      maxSteps: 5,
      headless: true
    });
    assert.equal(
      evidence.toolArtifactPath(4, "browser_snapshot", "../../page result.yml"),
      join(evidence.runDirectory, "tool-004-browser_snapshot-page-result.yml")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
