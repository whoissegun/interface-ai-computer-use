import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCapabilityArtifact } from "./artifact.js";
import { ReplayEvidenceRecorder } from "./evidence.js";
import { replayCapability } from "./executor.js";
import type { CapabilityValue, ReplayResult } from "./types.js";
import { PlaywrightMcpClient } from "../surface/playwright-mcp.js";

const targetUrl = "https://target-app-gamma.vercel.app/";
const evidenceRoot = resolve("evidence/replay");

const cases: Array<{
  name: string;
  artifactPath: string;
  inputs: Record<string, CapabilityValue>;
  approveRisky?: boolean;
}> = [
  {
    name: "find-member",
    artifactPath: "capabilities/northstar.find-member.v1.json",
    inputs: { memberNumber: "100042" }
  },
  {
    name: "read-balance",
    artifactPath: "capabilities/northstar.read-balance.v1.json",
    inputs: { memberNumber: "100042", accountNumber: "S-0042-01" }
  },
  {
    name: "prepare-subaccount",
    artifactPath: "capabilities/northstar.prepare-subaccount.v1.json",
    inputs: {
      memberNumber: "100042",
      product: "HOLIDAY_SAVINGS",
      nickname: "Rainy Day",
      openingDeposit: 25,
      statementDelivery: "ELECTRONIC"
    }
  },
  {
    name: "simulate-subaccount",
    artifactPath: "capabilities/northstar.simulate-subaccount.v1.json",
    inputs: {
      memberNumber: "100042",
      product: "REGULAR_SAVINGS",
      nickname: "Emergency Fund",
      openingDeposit: 40,
      statementDelivery: "PAPER"
    },
    approveRisky: true
  }
];

function stableResult(result: ReplayResult): unknown {
  return {
    capabilityId: result.capabilityId,
    capabilityVersion: result.capabilityVersion,
    status: result.status,
    completedSteps: result.completedSteps,
    recoveries: result.recoveries,
    humanHandoffs: result.humanHandoffs,
    ...(result.status === "success" ? { output: result.output } : {})
  };
}

const report: {
  targetOrigin: string;
  repetitions: number;
  llmInDecisionLoop: false;
  cases: Array<{
    name: string;
    consistent: boolean;
    runIds: string[];
    stableResult: unknown;
  }>;
} = {
  targetOrigin: new URL(targetUrl).origin,
  repetitions: 3,
  llmInDecisionLoop: false,
  cases: []
};

for (const replayCase of cases) {
  const artifact = await loadCapabilityArtifact(replayCase.artifactPath);
  const results: ReplayResult[] = [];
  for (let repetition = 1; repetition <= report.repetitions; repetition += 1) {
    console.error(`${replayCase.name}: live repetition ${repetition}/${report.repetitions}`);
    const evidence = await ReplayEvidenceRecorder.create({
      rootDirectory: evidenceRoot,
      artifact,
      inputs: replayCase.inputs,
      targetUrl,
      headless: true
    });
    const surface = new PlaywrightMcpClient({
      outputDirectory: evidence.playwrightDirectory,
      targetOrigin: new URL(targetUrl).origin,
      headless: true,
      clientName: "deterministic-stability-check",
      onStderr: (text) => void evidence.recordMcpStderr(text)
    });
    const result = await replayCapability({
      artifact,
      inputs: replayCase.inputs,
      targetUrl,
      surface,
      evidence,
      ...(replayCase.approveRisky ? { approveRisky: true } : {})
    });
    if (result.status !== "success") {
      throw new Error(`${replayCase.name} repetition ${repetition} ended as ${result.status}.`);
    }
    results.push(result);
  }
  const signatures = results.map((result) => JSON.stringify(stableResult(result)));
  const consistent = new Set(signatures).size === 1;
  if (!consistent) throw new Error(`${replayCase.name} produced inconsistent stable results.`);
  report.cases.push({
    name: replayCase.name,
    consistent,
    runIds: results.map((result) => result.runId),
    stableResult: stableResult(results[0] as ReplayResult)
  });
}

const filename = resolve(
  evidenceRoot,
  `stability-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}.json`
);
await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: "success", report: filename, cases: report.cases }, null, 2));
