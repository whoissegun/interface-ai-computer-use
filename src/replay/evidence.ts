import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CapabilityArtifact, CapabilityValue, ReplayResult } from "./types.js";

function timestampForPath(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function mask(
  value: CapabilityValue,
  policy: "plain" | "last4" | "redact"
): CapabilityValue | string {
  if (policy === "plain") return value;
  if (policy === "last4") return `***${String(value).slice(-4)}`;
  return "[REDACTED]";
}

export class ReplayEvidenceRecorder {
  readonly runId: string;
  readonly runDirectory: string;
  readonly playwrightDirectory: string;
  private readonly eventFile: string;
  private sequence = 0;

  private constructor(
    readonly artifact: CapabilityArtifact,
    rootDirectory: string,
    startedAt: Date
  ) {
    this.runId = `${timestampForPath(startedAt)}-${artifact.id.replaceAll(/[^a-zA-Z0-9-]/g, "-")}-${randomUUID().slice(0, 8)}`;
    this.runDirectory = join(rootDirectory, this.runId);
    this.playwrightDirectory = join(this.runDirectory, "playwright");
    this.eventFile = join(this.runDirectory, "events.ndjson");
  }

  static async create(options: {
    rootDirectory: string;
    artifact: CapabilityArtifact;
    inputs: Record<string, CapabilityValue>;
    targetUrl: string;
    headless: boolean;
    startedAt?: Date;
  }): Promise<ReplayEvidenceRecorder> {
    const startedAt = options.startedAt ?? new Date();
    const recorder = new ReplayEvidenceRecorder(options.artifact, options.rootDirectory, startedAt);
    await mkdir(recorder.playwrightDirectory, { recursive: true });
    const safeInputs = Object.fromEntries(
      Object.entries(options.inputs).map(([name, value]) => [
        name,
        mask(value, options.artifact.inputs[name]?.logPolicy ?? "redact")
      ])
    );
    await writeFile(
      join(recorder.runDirectory, "run.json"),
      `${JSON.stringify(
        {
          runId: recorder.runId,
          capability: { id: options.artifact.id, version: options.artifact.version },
          targetOrigin: new URL(options.targetUrl).origin,
          inputs: safeInputs,
          headless: options.headless,
          llmInDecisionLoop: false,
          startedAt: startedAt.toISOString()
        },
        null,
        2
      )}\n`
    );
    return recorder;
  }

  async record(type: string, data: unknown): Promise<void> {
    this.sequence += 1;
    await appendFile(
      this.eventFile,
      `${JSON.stringify({ sequence: this.sequence, at: new Date().toISOString(), type, data })}\n`
    );
  }

  async recordMcpStderr(text: string): Promise<void> {
    await appendFile(join(this.runDirectory, "playwright-mcp.stderr.log"), text);
  }

  failureScreenshotPath(): string {
    return join(this.runDirectory, "failure.png");
  }

  async finish(result: ReplayResult): Promise<void> {
    const safeResult: ReplayResult =
      result.status === "success"
        ? {
            ...result,
            output: Object.fromEntries(
              Object.entries(result.output).map(([name, value]) => [
                name,
                mask(value, this.artifact.outputs[name]?.logPolicy ?? "redact")
              ])
            )
          }
        : result;
    await writeFile(
      join(this.runDirectory, "summary.json"),
      `${JSON.stringify(safeResult, null, 2)}\n`
    );
    await this.record("replay_finished", safeResult);
  }

  evidenceFilename(path: string): string {
    return basename(path);
  }
}
