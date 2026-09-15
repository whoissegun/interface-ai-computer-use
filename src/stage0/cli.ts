import "dotenv/config";
import { parseArgs } from "node:util";
import { relative, resolve } from "node:path";
import { EvidenceRecorder } from "./evidence.js";
import { OpenRouterClient } from "./openrouter.js";
import { PlaywrightMcpClient } from "./playwright-mcp.js";
import { runDiscovery } from "./runner.js";
import { getScenario, scenarios } from "./scenarios.js";
import { compileDiscoveryRun, supportsArtifactCompilation } from "./artifact-compiler.js";

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
    "wait-for-human": { type: "boolean", default: false },
    "human-timeout-ms": { type: "string", default: "900000" },
    "human-poll-ms": { type: "string", default: "1000" },
    "emit-artifact": { type: "boolean", default: false },
    "artifact-output": { type: "string" },
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
const emitArtifact = Boolean(parsed.values["emit-artifact"] || parsed.values["artifact-output"]);
if (emitArtifact && !supportsArtifactCompilation(scenario.id)) {
  throw new Error(
    `--emit-artifact currently supports scenario a1; ${scenario.id} has no reviewed compiler profile.`
  );
}
const model = parsed.values.model ?? "anthropic/claude-opus-5";
const reasoningEffort = parsed.values["reasoning-effort"] ?? "high";
const targetUrl = new URL(parsed.values["target-url"] ?? "https://target-app-gamma.vercel.app/").toString();
const maxSteps = Number.parseInt(parsed.values["max-steps"] ?? "30", 10);
const maxTokens = Number.parseInt(parsed.values["max-tokens"] ?? "12000", 10);
const waitForHuman = parsed.values["wait-for-human"] ?? false;
const humanTimeoutMs = Number.parseInt(parsed.values["human-timeout-ms"] ?? "900000", 10);
const humanPollMs = Number.parseInt(parsed.values["human-poll-ms"] ?? "1000", 10);
if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("--max-steps must be a positive integer.");
if (!Number.isInteger(maxTokens) || maxTokens < 1024) throw new Error("--max-tokens must be at least 1024.");
if (!Number.isInteger(humanTimeoutMs) || humanTimeoutMs < 1000) {
  throw new Error("--human-timeout-ms must be at least 1000.");
}
if (!Number.isInteger(humanPollMs) || humanPollMs < 100) {
  throw new Error("--human-poll-ms must be at least 100.");
}
if (waitForHuman && !parsed.values.headed) {
  throw new Error("--wait-for-human requires --headed so a person can access the live browser.");
}
if (waitForHuman && !scenario.humanHandoff) {
  throw new Error(`Scenario ${scenario.id} does not define a live human handoff.`);
}

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
    waitForHuman,
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
if (waitForHuman) console.log(`Live human handoff: enabled (${humanTimeoutMs} ms timeout)`);

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
    ...(waitForHuman
      ? {
          liveHumanHandoff: {
            timeoutMs: humanTimeoutMs,
            pollIntervalMs: humanPollMs
          }
        }
      : {}),
    startedAt,
    onProgress: console.log
  });
  await Promise.allSettled(pendingStderr);
  if (emitArtifact) {
    if (summary.status !== "completed") {
      throw new Error(`Cannot emit an artifact from a discovery run with status ${summary.status}.`);
    }
    const compilation = await compileDiscoveryRun({
      runDirectory: evidence.runDirectory,
      ...(parsed.values["artifact-output"]
        ? { outputPath: resolve(parsed.values["artifact-output"]) }
        : {})
    });
    await evidence.record("artifact_compiled", {
      compilerProfile: compilation.report.compilerProfile,
      artifactPath: relative(evidence.runDirectory, compilation.artifactPath),
      reportPath: relative(evidence.runDirectory, compilation.reportPath),
      validation: compilation.report.validation
    });
    console.log(`Artifact: ${compilation.artifactPath}`);
    console.log(`Compilation report: ${compilation.reportPath}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "completed" ? 0 : 1;
} catch (error) {
  await Promise.allSettled(pendingStderr);
  throw error;
}
