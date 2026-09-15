import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildCapabilityFromDiscoveryRun,
  compileDiscoveryRun
} from "./artifact-compiler.js";

const successfulRun = fileURLToPath(
  new URL(
    "../../evidence/stage0/2026-09-12T04-42-43-561Z-a1-3ba9b18a/",
    import.meta.url
  )
);

test("a completed a1 trace compiles into a validated parameterized capability", async () => {
  const { artifact, report } = await buildCapabilityFromDiscoveryRun(successfulRun);
  assert.equal(artifact.id, "northstar.find-member");
  assert.deepEqual(
    artifact.steps.map((step) => step.action),
    ["navigate", "click", "type", "click"]
  );
  assert.equal(artifact.provenance.discoveryRunIds[0], "2026-09-12T04-42-43-561Z-a1-3ba9b18a");
  assert.equal(artifact.provenance.compiledBy, "reviewed_trace_compiler");
  assert.equal(artifact.surface.applicationVersion, "7.4");
  assert.equal(report.validation, "passed");
  assert.equal(report.recognizedActions.length, 4);

  const serialized = JSON.stringify(artifact);
  assert.equal(serialized.includes("f1e3"), false, "temporary Playwright refs must be discarded");
  assert.equal(serialized.includes("100042"), false, "sample inputs must be parameterized");
});

test("the compiler writes both the artifact and an inspectable compilation report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discovery-compiler-"));
  await cp(successfulRun, directory, { recursive: true });
  const result = await compileDiscoveryRun({ runDirectory: directory });
  const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as Record<string, unknown>;
  const report = JSON.parse(await readFile(result.reportPath, "utf8")) as Record<string, unknown>;
  assert.equal(artifact.kind, "computer_use_capability");
  assert.equal(report.kind, "discovery_artifact_compilation");
  assert.equal(report.ephemeralTargetsPersisted, false);
  assert.equal(report.sampleInputValuesPersisted, false);
});

test("failed or unrecognized discovery trajectories fail closed", async () => {
  const failedDirectory = await mkdtemp(join(tmpdir(), "discovery-compiler-failed-"));
  await cp(successfulRun, failedDirectory, { recursive: true });
  const failedSummaryPath = join(failedDirectory, "summary.json");
  const failedSummary = JSON.parse(await readFile(failedSummaryPath, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(failedSummaryPath, `${JSON.stringify({ ...failedSummary, status: "failed" })}\n`);
  await assert.rejects(
    buildCapabilityFromDiscoveryRun(failedDirectory),
    /Only a completed discovery run/
  );

  const changedDirectory = await mkdtemp(join(tmpdir(), "discovery-compiler-changed-"));
  await cp(successfulRun, changedDirectory, { recursive: true });
  const eventsPath = join(changedDirectory, "events.ndjson");
  const events = await readFile(eventsPath, "utf8");
  const unexpected = JSON.stringify({
    sequence: 999,
    type: "tool_requested",
    data: {
      toolCallNumber: 10,
      toolName: "browser_click",
      arguments: { target: "f2e44", element: "F9 - Open New Share/Sub-account button" }
    }
  });
  await writeFile(eventsPath, `${events}${unexpected}\n`);
  await assert.rejects(
    buildCapabilityFromDiscoveryRun(changedDirectory),
    /exactly four recognized business actions/
  );
});
