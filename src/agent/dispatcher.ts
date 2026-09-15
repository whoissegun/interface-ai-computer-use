import type { SurfaceClient } from "../surface/types.js";
import { ReplayEvidenceRecorder } from "../replay/evidence.js";
import { replayCapability, type ReplayHumanHandoffOptions } from "../replay/executor.js";
import type { CapabilityExecutor, CapabilityRegistration } from "./types.js";

export class ReplayCapabilityDispatcher implements CapabilityExecutor {
  constructor(
    private readonly options: {
      targetUrl: string;
      evidenceRoot: string;
      headless: boolean;
      approveRisky: boolean;
      surfaceFactory: (
        outputDirectory: string,
        onStderr: (text: string) => void
      ) => SurfaceClient;
      humanHandoff?: ReplayHumanHandoffOptions;
    }
  ) {}

  async execute(
    registration: CapabilityRegistration,
    inputs: Record<string, unknown>,
    _callNumber: number
  ) {
    const evidence = await ReplayEvidenceRecorder.create({
      rootDirectory: this.options.evidenceRoot,
      artifact: registration.artifact,
      inputs,
      targetUrl: this.options.targetUrl,
      headless: this.options.headless
    });
    const surface = this.options.surfaceFactory(
      evidence.playwrightDirectory,
      (text) => void evidence.recordMcpStderr(text)
    );
    return replayCapability({
      artifact: registration.artifact,
      inputs,
      targetUrl: this.options.targetUrl,
      surface,
      evidence,
      approveRisky: this.options.approveRisky,
      ...(this.options.humanHandoff ? { humanHandoff: this.options.humanHandoff } : {})
    });
  }
}
