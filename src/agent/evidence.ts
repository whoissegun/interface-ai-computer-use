import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvidence, AgentRunSummary, CapabilityRegistration } from "./types.js";

function pathTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export class AgentEvidenceRecorder implements AgentEvidence {
  readonly runId: string;
  readonly runDirectory: string;
  readonly capabilityEvidenceDirectory: string;
  private readonly eventFile: string;
  private sequence = 0;

  private constructor(rootDirectory: string, startedAt: Date) {
    this.runId = `${pathTimestamp(startedAt)}-agent-${randomUUID().slice(0, 8)}`;
    this.runDirectory = join(rootDirectory, this.runId);
    this.capabilityEvidenceDirectory = join(this.runDirectory, "capabilities");
    this.eventFile = join(this.runDirectory, "events.ndjson");
  }

  static async create(options: {
    rootDirectory: string;
    task: string;
    model: string;
    maxCapabilityCalls: number;
    riskyActionApproved: boolean;
    registrations: CapabilityRegistration[];
    startedAt?: Date;
  }): Promise<AgentEvidenceRecorder> {
    const startedAt = options.startedAt ?? new Date();
    const recorder = new AgentEvidenceRecorder(options.rootDirectory, startedAt);
    await mkdir(recorder.capabilityEvidenceDirectory, { recursive: true });
    await writeFile(
      join(recorder.runDirectory, "run.json"),
      `${JSON.stringify(
        {
          runId: recorder.runId,
          task: options.task,
          model: options.model,
          maxCapabilityCalls: options.maxCapabilityCalls,
          riskyActionApproved: options.riskyActionApproved,
          offeredCapabilities: options.registrations.map((registration) => ({
            toolName: registration.toolName,
            artifactId: registration.artifact.id,
            artifactVersion: registration.artifact.version
          })),
          modelChoosesCapability: true,
          llmInReplayDecisionLoop: false,
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

  async finish(summary: AgentRunSummary): Promise<void> {
    await writeFile(
      join(this.runDirectory, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`
    );
    await this.record("agent_finished", summary);
  }
}
