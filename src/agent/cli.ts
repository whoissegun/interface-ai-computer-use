import "dotenv/config";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { OpenRouterClient } from "../model/openrouter.js";
import { PlaywrightMcpClient } from "../surface/playwright-mcp.js";
import { loadCapabilityCatalog } from "./catalog.js";
import { ReplayCapabilityDispatcher } from "./dispatcher.js";
import { AgentEvidenceRecorder } from "./evidence.js";
import { runCapabilityAgent } from "./runner.js";

const parsed = parseArgs({
  options: {
    task: { type: "string" },
    model: {
      type: "string",
      default: process.env.OPENROUTER_ROUTER_MODEL ?? "moonshotai/kimi-k2.6"
    },
    "reasoning-effort": {
      type: "string",
      default: process.env.OPENROUTER_ROUTER_REASONING_EFFORT ?? "medium"
    },
    "target-url": {
      type: "string",
      default: process.env.TARGET_APP_URL ?? "https://target-app-gamma.vercel.app/"
    },
    "max-calls": { type: "string", default: "3" },
    "max-tokens": { type: "string", default: "4000" },
    "approve-risky": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    "wait-for-human": { type: "boolean", default: false },
    "human-timeout-ms": { type: "string", default: "300000" }
  },
  strict: true
});

const task = parsed.values.task?.trim();
if (!task) throw new Error("--task is required.");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing from the local environment.");
const model = parsed.values.model ?? "moonshotai/kimi-k2.6";
const reasoningEffort = parsed.values["reasoning-effort"] ?? "medium";
const targetUrl = new URL(
  parsed.values["target-url"] ?? "https://target-app-gamma.vercel.app/"
).toString();
const maxCapabilityCalls = Number.parseInt(parsed.values["max-calls"] ?? "3", 10);
const maxTokens = Number.parseInt(parsed.values["max-tokens"] ?? "4000", 10);
const humanTimeoutMs = Number.parseInt(parsed.values["human-timeout-ms"] ?? "300000", 10);
if (!Number.isInteger(maxCapabilityCalls) || maxCapabilityCalls < 1 || maxCapabilityCalls > 3) {
  throw new Error("--max-calls must be between 1 and the current safety ceiling of 3.");
}
if (!Number.isInteger(maxTokens) || maxTokens < 512) {
  throw new Error("--max-tokens must be at least 512.");
}
if (!Number.isInteger(humanTimeoutMs) || humanTimeoutMs < 1000) {
  throw new Error("--human-timeout-ms must be at least 1000.");
}

const approveRisky = parsed.values["approve-risky"] ?? false;
const waitForHuman = parsed.values["wait-for-human"] ?? false;
const headless = !(parsed.values.headed || waitForHuman);
const registrations = await loadCapabilityCatalog({ includeRisky: approveRisky });
const startedAt = new Date();
const evidence = await AgentEvidenceRecorder.create({
  rootDirectory: resolve("evidence/agent"),
  task,
  model,
  maxCapabilityCalls,
  riskyActionApproved: approveRisky,
  registrations,
  startedAt
});
const dispatcher = new ReplayCapabilityDispatcher({
  targetUrl,
  evidenceRoot: evidence.capabilityEvidenceDirectory,
  headless,
  approveRisky,
  surfaceFactory: (outputDirectory, onStderr) =>
    new PlaywrightMcpClient({
      outputDirectory,
      targetOrigin: new URL(targetUrl).origin,
      headless,
      clientName: "natural-language-capability-replay",
      onStderr
    }),
  humanHandoff: {
    enabled: waitForHuman,
    timeoutMs: humanTimeoutMs,
    pollIntervalMs: 500,
    onProgress: (message) => console.error(message)
  }
});

console.error(`Agent run: ${evidence.runId}`);
console.error(`Model: ${model} (${reasoningEffort})`);
console.error(`Capabilities: ${registrations.map((registration) => registration.toolName).join(", ")}`);
console.error(`Maximum capability calls: ${maxCapabilityCalls}`);
console.error(`Evidence: ${evidence.runDirectory}`);

const summary = await runCapabilityAgent({
  task,
  model,
  reasoningEffort,
  maxTokens,
  maxCapabilityCalls,
  registrations,
  modelClient: new OpenRouterClient(apiKey),
  capabilityExecutor: dispatcher,
  evidence,
  startedAt,
  onProgress: (message) => console.error(message)
});
console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
