import "dotenv/config";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { EvidenceRecorder } from "./evidence.js";
import { OpenRouterClient } from "./openrouter.js";
import { PlaywrightMcpClient } from "./playwright-mcp.js";
import { runDiscovery } from "./runner.js";
import { getScenario, scenarios } from "./scenarios.js";

const parsed = parseArgs({
  options: {
    scenario: { type: "string", short: "s", default: "a1" },
    model: {
      type: "string",
      default: process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-5"
    },
    "reasoning-effort": {
      type: "string",
      default: process.env.OPENROUTER_REASONING_EFFORT ?? "high"
    },
    "target-url": {
      type: "string",
      default: process.env.TARGET_APP_URL ?? "https://target-app-gamma.vercel.app/"
    },
    "max-steps": { type: "string", default: "30" },
    "max-tokens": { type: "string", default: "12000" },
    headed: { type: "boolean", default: false },
    list: { type: "boolean", default: false }
  },
  strict: true
});

if (parsed.values.list) {
  for (const scenario of Object.values(scenarios)) {
    console.log(`${scenario.id.padEnd(7)} ${scenario.name}`);
  }
  process.exit(0);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is missing. Copy .env.example to .env and add the local key.");
}

const scenario = getScenario(parsed.values.scenario ?? "a1");
const model = parsed.values.model ?? "anthropic/claude-opus-5";
const reasoningEffort = parsed.values["reasoning-effort"] ?? "high";
const targetUrl = new URL(parsed.values["target-url"] ?? "https://target-app-gamma.vercel.app/").toString();
const maxSteps = Number.parseInt(parsed.values["max-steps"] ?? "30", 10);
const maxTokens = Number.parseInt(parsed.values["max-tokens"] ?? "12000", 10);
if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("--max-steps must be a positive integer.");
if (!Number.isInteger(maxTokens) || maxTokens < 1024) throw new Error("--max-tokens must be at least 1024.");

const startedAt = new Date();
const evidence = await EvidenceRecorder.create(
  {
    rootDirectory: resolve("evidence/stage0"),
    scenario,
    targetUrl,
    model,
    reasoningEffort,
    maxSteps,
    headless: !parsed.values.headed,
    secrets: [apiKey]
  },
  startedAt
);

const pendingStderr: Promise<void>[] = [];
const browser = new PlaywrightMcpClient({
  outputDirectory: evidence.playwrightDirectory,
  targetOrigin: new URL(targetUrl).origin,
  headless: !parsed.values.headed,
  onStderr: (text) => pendingStderr.push(evidence.recordMcpStderr(text))
});

console.log(`Run: ${evidence.runId}`);
console.log(`Scenario: ${scenario.id} — ${scenario.name}`);
console.log(`Model: ${model} (${reasoningEffort} reasoning)`);
console.log(`Evidence: ${evidence.runDirectory}`);

try {
  const summary = await runDiscovery({
    scenario,
    targetUrl,
    model,
    reasoningEffort,
    maxSteps,
    maxTokens,
    modelClient: new OpenRouterClient(apiKey),
    browserClient: browser,
    evidence,
    startedAt,
    onProgress: console.log
  });
  await Promise.allSettled(pendingStderr);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "completed" ? 0 : 1;
} catch (error) {
  await Promise.allSettled(pendingStderr);
  throw error;
}
