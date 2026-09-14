import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserTool, BrowserToolResult, JsonObject, ModelTool, RunSummary, Scenario } from "./types.js";

type EvidenceConfig = {
  rootDirectory: string;
  scenario: Scenario;
  targetUrl: string;
  model: string;
  reasoningEffort: string;
  maxSteps: number;
  headless: boolean;
  waitForHuman?: boolean;
  secrets?: string[];
};

function timestampForPath(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp"
  };
  return known[mimeType] ?? extname(mimeType) ?? ".bin";
}

export class EvidenceRecorder {
  readonly runId: string;
  readonly runDirectory: string;
  readonly playwrightDirectory: string;
  private readonly eventFile: string;
  private readonly secrets: string[];
  private sequence = 0;

  private constructor(private readonly config: EvidenceConfig, startedAt: Date) {
    this.runId = `${timestampForPath(startedAt)}-${config.scenario.id}-${randomUUID().slice(0, 8)}`;
    this.runDirectory = join(config.rootDirectory, this.runId);
    this.playwrightDirectory = join(this.runDirectory, "playwright");
    this.eventFile = join(this.runDirectory, "events.ndjson");
    this.secrets = (config.secrets ?? []).filter(Boolean);
  }

  static async create(config: EvidenceConfig, startedAt = new Date()): Promise<EvidenceRecorder> {
    const recorder = new EvidenceRecorder(config, startedAt);
    await mkdir(recorder.playwrightDirectory, { recursive: true });
    await writeFile(
      join(recorder.runDirectory, "run.json"),
      `${JSON.stringify(
        {
          runId: recorder.runId,
          scenario: config.scenario,
          targetUrl: config.targetUrl,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          maxSteps: config.maxSteps,
          headless: config.headless,
          waitForHuman: config.waitForHuman ?? false,
          startedAt: startedAt.toISOString()
        },
        null,
        2
      )}\n`
    );
    return recorder;
  }

  private redact(value: unknown): unknown {
    if (typeof value === "string") {
      return this.secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
    }
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this.redact(item)])
      );
    }
    return value;
  }

  async record(type: string, data: unknown): Promise<void> {
    this.sequence += 1;
    const event = {
      sequence: this.sequence,
      at: new Date().toISOString(),
      type,
      data: this.redact(data)
    };
    await appendFile(this.eventFile, `${JSON.stringify(event)}\n`);
  }

  async recordToolResult(
    toolCallNumber: number,
    toolName: string,
    result: BrowserToolResult
  ): Promise<string> {
    const contentForModel: unknown[] = [];
    const contentForEvidence: unknown[] = [];
    let imageNumber = 0;

    for (const item of result.content ?? []) {
      if (item && typeof item === "object") {
        const block = item as Record<string, unknown>;
        if (block.type === "image" && typeof block.data === "string") {
          imageNumber += 1;
          const mimeType = typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream";
          const filename = `tool-${String(toolCallNumber).padStart(3, "0")}-${toolName}-${imageNumber}${extensionFor(mimeType)}`;
          await writeFile(join(this.runDirectory, filename), Buffer.from(block.data, "base64"));
          const replacement = { type: "image", mimeType, savedAs: filename };
          contentForModel.push(replacement);
          contentForEvidence.push(replacement);
          continue;
        }
      }
      contentForModel.push(item);
      contentForEvidence.push(item);
    }

    const safeResult = {
      ...result,
      content: contentForEvidence
    };
    await this.record("tool_result", { toolCallNumber, toolName, result: safeResult });

    return JSON.stringify(
      this.redact({
        isError: result.isError ?? false,
        content: contentForModel,
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent })
      })
    );
  }

  async writeToolCatalog(
    discovered: BrowserTool[],
    offered: ModelTool[],
    withheld: Array<BrowserTool & { reason: string }>
  ): Promise<void> {
    await Promise.all([
      writeFile(
        join(this.runDirectory, "discovered-tools.json"),
        `${JSON.stringify(discovered, null, 2)}\n`
      ),
      writeFile(join(this.runDirectory, "offered-tools.json"), `${JSON.stringify(offered, null, 2)}\n`),
      writeFile(
        join(this.runDirectory, "withheld-tools.json"),
        `${JSON.stringify(withheld, null, 2)}\n`
      )
    ]);
  }

  async finish(summary: RunSummary): Promise<void> {
    await writeFile(join(this.runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await this.record("run_finished", summary);
  }

  async recordMcpStderr(text: string): Promise<void> {
    const safe = this.redact(text);
    await appendFile(join(this.runDirectory, "playwright-mcp.stderr.log"), String(safe));
  }

  toolArtifactPath(toolCallNumber: number, toolName: string, requestedFilename: string): string {
    const extension = extname(requestedFilename);
    const requestedStem = basename(requestedFilename, extension)
      .replaceAll(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 80);
    const safeStem = requestedStem || "artifact";
    const safeToolName = toolName.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
    return join(
      this.runDirectory,
      `tool-${String(toolCallNumber).padStart(3, "0")}-${safeToolName}-${safeStem}${extension}`
    );
  }

  describe(): JsonObject {
    return { runId: this.runId, runDirectory: this.runDirectory };
  }
}
