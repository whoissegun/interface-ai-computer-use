import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadCapabilityArtifact } from "./artifact.js";
import { ReplayEvidenceRecorder } from "./evidence.js";
import { replayCapability } from "./executor.js";
import { PlaywrightMcpClient } from "../surface/playwright-mcp.js";

const parsed = parseArgs({
  options: {
    artifact: {
      type: "string",
      default: "capabilities/northstar.find-member.v1.json"
    },
    "member-number": { type: "string" },
    "account-number": { type: "string" },
    product: { type: "string" },
    nickname: { type: "string" },
    "opening-deposit": { type: "string" },
    "statement-delivery": { type: "string" },
    "target-url": {
      type: "string",
      default: "https://target-app-gamma.vercel.app/"
    },
    "evidence-root": { type: "string", default: "evidence/replay" },
    headed: { type: "boolean", default: false },
    "approve-risky": { type: "boolean", default: false },
    "wait-for-human": { type: "boolean", default: false },
    "human-timeout-ms": { type: "string", default: "300000" }
  },
  strict: true
});

const artifactPath = resolve(parsed.values.artifact ?? "capabilities/northstar.find-member.v1.json");
const targetUrl = new URL(
  parsed.values["target-url"] ?? "https://target-app-gamma.vercel.app/"
).toString();
const artifact = await loadCapabilityArtifact(artifactPath);
const waitForHuman = parsed.values["wait-for-human"] ?? false;
const headless = !(parsed.values.headed || waitForHuman);
const flagByInput: Record<string, keyof typeof parsed.values> = {
  memberNumber: "member-number",
  accountNumber: "account-number",
  product: "product",
  nickname: "nickname",
  openingDeposit: "opening-deposit",
  statementDelivery: "statement-delivery"
};
const inputs = Object.fromEntries(
  Object.entries(artifact.inputs).map(([name, spec]) => {
    const flag = flagByInput[name];
    if (!flag) throw new Error(`The CLI has no flag mapping for artifact input ${name}.`);
    const raw = parsed.values[flag];
    if (raw === undefined) throw new Error(`--${String(flag)} is required for ${artifact.id}.`);
    if (spec.type === "number") {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) throw new Error(`--${String(flag)} must be a number.`);
      return [name, numeric];
    }
    return [name, raw];
  })
);
const timeoutMs = Number(parsed.values["human-timeout-ms"] ?? "300000");
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--human-timeout-ms must be a positive integer.");
}
const evidence = await ReplayEvidenceRecorder.create({
  rootDirectory: resolve(parsed.values["evidence-root"] ?? "evidence/replay"),
  artifact,
  inputs,
  targetUrl,
  headless
});
const surface = new PlaywrightMcpClient({
  outputDirectory: evidence.playwrightDirectory,
  targetOrigin: new URL(targetUrl).origin,
  headless,
  clientName: "deterministic-replay",
  onStderr: (text) => {
    void evidence.recordMcpStderr(text);
  }
});

console.error(`Capability: ${artifact.id}@${artifact.version}`);
console.error(`Evidence: ${evidence.runDirectory}`);
console.error("LLM decision loop: disabled");

const result = await replayCapability({
  artifact,
  inputs,
  targetUrl,
  surface,
  evidence,
  approveRisky: parsed.values["approve-risky"] ?? false,
  humanHandoff: {
    enabled: waitForHuman,
    timeoutMs,
    pollIntervalMs: 500,
    onProgress: (message) => console.error(message)
  }
});
console.log(JSON.stringify(result, null, 2));

if (result.status === "failure") process.exitCode = 1;
if (result.status === "human_required") process.exitCode = 2;
