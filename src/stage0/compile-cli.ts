import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { compileDiscoveryRun } from "./artifact-compiler.js";

const parsed = parseArgs({
  options: {
    "run-dir": { type: "string" },
    output: { type: "string" }
  },
  strict: true
});

const runDirectory = parsed.values["run-dir"];
if (!runDirectory) throw new Error("--run-dir is required.");

const result = await compileDiscoveryRun({
  runDirectory: resolve(runDirectory),
  ...(parsed.values.output ? { outputPath: resolve(parsed.values.output) } : {})
});

console.log(
  JSON.stringify(
    {
      status: result.report.status,
      sourceRunId: result.report.sourceRunId,
      compilerProfile: result.report.compilerProfile,
      artifactPath: result.artifactPath,
      reportPath: result.reportPath
    },
    null,
    2
  )
);
