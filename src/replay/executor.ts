import type { SurfaceClient, SurfaceToolResult } from "../surface/types.js";
import { validateCapabilityInputs, ArtifactValidationError } from "./artifact.js";
import {
  AccessibilityResolutionError,
  extractAccessibilityTableRow,
  resolveAccessibilityLocator,
  textFromSurfaceResult
} from "./accessibility.js";
import { ReplayEvidenceRecorder } from "./evidence.js";
import type {
  CapabilityArtifact,
  CapabilityValue,
  HumanHandoffRecord,
  KnownOutcome,
  ReplayFailure,
  ReplayMetadata,
  ReplayResult,
  ReplayStep
} from "./types.js";

export type ReplayHumanHandoffOptions = {
  enabled: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
  requestDecision?: (
    outcome: Extract<KnownOutcome, { classification: "human_required" }>,
    signal: AbortSignal
  ) => Promise<"approved" | "rejected">;
  onProgress?: (message: string) => void;
};

type ResultBody =
  | { status: "success"; output: Record<string, CapabilityValue> }
  | { status: "business_outcome"; code: string; message: string; stepId: string }
  | {
      status: "human_required";
      code: string;
      message: string;
      stepId: string;
      evidenceArtifact?: string;
    }
  | {
      status: "failure";
      failureKind: ReplayFailure["failureKind"];
      message: string;
      stepId: string;
      code?: string;
      evidenceArtifact?: string;
    };

class ReplayExecutionError extends Error {
  constructor(
    readonly failureKind: ReplayFailure["failureKind"],
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

const actionToTool = {
  navigate: "browser_navigate",
  find: "browser_find",
  click: "browser_click",
  type: "browser_type",
  select_option: "browser_select_option",
  click_choice: "browser_click",
  verify: "browser_snapshot",
  handle_dialog: "browser_handle_dialog",
  snapshot: "browser_snapshot",
  screenshot: "browser_take_screenshot"
} as const;

async function checkedCall(
  surface: SurfaceClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<SurfaceToolResult> {
  const result = await surface.callTool(toolName, args);
  if (result.isError) throw new ReplayExecutionError("surface_error", `${toolName} returned an error.`);
  return result;
}

async function snapshotText(surface: SurfaceClient): Promise<string> {
  return textFromSurfaceResult(await checkedCall(surface, "browser_snapshot", {}));
}

function requireCheckpoint(snapshot: string, text: string): void {
  if (!snapshot.includes(text)) {
    throw new ReplayExecutionError("ui_mismatch", `Expected visible checkpoint ${JSON.stringify(text)}.`);
  }
}

function stepEvent(step: ReplayStep): Record<string, unknown> {
  if (step.action === "navigate") return { id: step.id, action: step.action, path: step.path };
  if (step.action === "type" || step.action === "select_option") {
    return { id: step.id, action: step.action, locator: step.locator, input: step.input };
  }
  if (step.action === "click_choice") {
    return { id: step.id, action: step.action, input: step.input, choices: step.choices };
  }
  if (step.action === "verify") {
    return {
      id: step.id,
      action: step.action,
      checkpoint: step.checkpoint,
      fields: step.fields.map((field) => ({
        label: field.label,
        input: field.input,
        comparison: field.comparison
      }))
    };
  }
  if (step.action === "handle_dialog") {
    return { id: step.id, action: step.action, accept: step.accept };
  }
  return { id: step.id, action: step.action, locator: step.locator };
}

function inputValue(inputs: Record<string, CapabilityValue>, name: string, stepId: string): CapabilityValue {
  const value = inputs[name];
  if (value === undefined) {
    throw new ReplayExecutionError("invalid_input", `Step ${stepId} has no value for ${name}.`);
  }
  return value;
}

function numberFromVisible(value: string): number {
  const parsed = Number(value.replaceAll(/[^0-9+.-]/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new ReplayExecutionError("ui_mismatch", `Could not parse numeric value ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function tryHumanHandoff(options: {
  outcome: Extract<KnownOutcome, { classification: "human_required" }>;
  surface: SurfaceClient;
  evidence: ReplayEvidenceRecorder;
  inputs: Record<string, CapabilityValue>;
  handoff: ReplayHumanHandoffOptions | undefined;
  humanHandoffs: HumanHandoffRecord[];
}): Promise<boolean> {
  const definition = options.outcome.handoff;
  if (!definition || !options.handoff?.enabled) return false;

  const requestedAt = new Date().toISOString();
  await options.evidence.record("human_handoff_required", {
    code: options.outcome.code,
    instructions: definition.instructions,
    resumeCheckpoint: definition.resumeCheckpoint.text,
    requestedAt
  });
  options.handoff.onProgress?.(`NEEDS HUMAN — ${options.outcome.code}`);
  options.handoff.onProgress?.(definition.instructions);
  options.handoff.onProgress?.("The same browser session will stay open while replay waits.");

  const deadline = Date.now() + options.handoff.timeoutMs;
  if (options.handoff.requestDecision) {
    if (!definition.authorizedAction) {
      throw new ReplayExecutionError(
        "policy_denied",
        `Handoff ${options.outcome.code} has no declared authorized action.`
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.handoff.timeoutMs);
    let decision: "approved" | "rejected";
    try {
      decision = await options.handoff.requestDecision(options.outcome, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return false;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    await options.evidence.record("human_handoff_decision", {
      code: options.outcome.code,
      decision
    });
    if (decision === "rejected") return false;

    const target = await resolveAccessibilityLocator(
      options.surface,
      definition.authorizedAction,
      options.inputs
    );
    await checkedCall(options.surface, "browser_click", {
      target,
      element: definition.authorizedAction.name ?? "authorized human action"
    });
    await options.evidence.record("human_handoff_action_applied", {
      code: options.outcome.code,
      locator: definition.authorizedAction
    });
  }

  let checks = 0;
  while (Date.now() < deadline) {
    const snapshot = await snapshotText(options.surface);
    checks += 1;
    if (
      !snapshot.includes(options.outcome.marker) &&
      snapshot.includes(definition.resumeCheckpoint.text)
    ) {
      const record: HumanHandoffRecord = {
        code: options.outcome.code,
        requestedAt,
        resolvedAt: new Date().toISOString(),
        checks
      };
      options.humanHandoffs.push(record);
      await options.evidence.record("human_handoff_resumed", record);
      options.handoff.onProgress?.(
        `Human handoff ${options.outcome.code} completed; deterministic replay resumed.`
      );
      return true;
    }
    await wait(Math.min(options.handoff.pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  await options.evidence.record("human_handoff_timed_out", {
    code: options.outcome.code,
    timeoutMs: options.handoff.timeoutMs,
    checks
  });
  return false;
}

function verifyFields(
  snapshot: string,
  step: Extract<ReplayStep, { action: "verify" }>,
  inputs: Record<string, CapabilityValue>
): void {
  for (const field of step.fields) {
    const observed = extractAccessibilityTableRow(snapshot, field.label);
    const input = inputValue(inputs, field.input, step.id);
    const mapped = field.inputToVisible?.[String(input)] ?? input;
    const matches =
      field.comparison === "number"
        ? numberFromVisible(observed) === Number(mapped)
        : field.comparison === "starts_with"
          ? observed.startsWith(String(mapped))
          : observed === String(mapped);
    if (!matches) {
      throw new ReplayExecutionError(
        "ui_mismatch",
        `Review field ${field.label} did not match input ${field.input}.`
      );
    }
  }
}

async function executeStep(options: {
  artifact: CapabilityArtifact;
  surface: SurfaceClient;
  evidence: ReplayEvidenceRecorder;
  targetUrl: URL;
  inputs: Record<string, CapabilityValue>;
  step: ReplayStep;
}): Promise<ResultBody | undefined> {
  const { artifact, surface, evidence, targetUrl, inputs, step } = options;
  if (!artifact.risk.allowedActions.includes(step.action)) {
    throw new ReplayExecutionError("policy_denied", `Action ${step.action} is not allowed by the artifact.`);
  }
  await evidence.record("step_started", stepEvent(step));

  if (step.action === "navigate") {
    const destination = new URL(step.path, targetUrl);
    if (destination.origin !== targetUrl.origin) {
      throw new ReplayExecutionError("policy_denied", `Step ${step.id} leaves the configured origin.`);
    }
    await checkedCall(surface, "browser_navigate", { url: destination.toString() });
    requireCheckpoint(await snapshotText(surface), step.expect.text);
  } else if (step.action === "click") {
    let target: string;
    try {
      target = await resolveAccessibilityLocator(surface, step.locator, inputs);
    } catch (error) {
      if (error instanceof AccessibilityResolutionError && step.onMissing) {
        await evidence.record("known_outcome_observed", {
          classification: step.onMissing.classification,
          code: step.onMissing.code,
          source: "locator_not_found",
          stepId: step.id
        });
        return {
          status: "business_outcome",
          code: step.onMissing.code,
          message: step.onMissing.message,
          stepId: step.id
        };
      }
      throw error;
    }
    const result = await checkedCall(surface, "browser_click", {
      target,
      element: step.locator.name ?? `${step.locator.role} near ${step.locator.nearText}`
    });
    if (step.expectDialogText) {
      requireCheckpoint(textFromSurfaceResult(result), step.expectDialogText);
    }
    if (step.expect) requireCheckpoint(await snapshotText(surface), step.expect.text);
  } else if (step.action === "type") {
    const target = await resolveAccessibilityLocator(surface, step.locator, inputs);
    const value = inputValue(inputs, step.input, step.id);
    await checkedCall(surface, "browser_type", {
      target,
      element: `${step.locator.role} near ${step.locator.nearText ?? step.locator.name}`,
      text: String(value)
    });
  } else if (step.action === "select_option") {
    const target = await resolveAccessibilityLocator(surface, step.locator, inputs);
    const value = inputValue(inputs, step.input, step.id);
    const option = step.options[String(value)];
    if (!option) {
      throw new ReplayExecutionError(
        "invalid_input",
        `Step ${step.id} has no option mapping for ${String(value)}.`
      );
    }
    await checkedCall(surface, "browser_select_option", {
      target,
      element: step.locator.name ?? `${step.locator.role} near ${step.locator.nearText}`,
      values: [option]
    });
  } else if (step.action === "click_choice") {
    const value = inputValue(inputs, step.input, step.id);
    const locator = step.choices[String(value)];
    if (!locator) {
      throw new ReplayExecutionError(
        "invalid_input",
        `Step ${step.id} has no choice mapping for ${String(value)}.`
      );
    }
    const target = await resolveAccessibilityLocator(surface, locator, inputs);
    await checkedCall(surface, "browser_click", {
      target,
      element: locator.name ?? `${locator.role} near ${locator.nearText}`
    });
  } else if (step.action === "verify") {
    const snapshot = await snapshotText(surface);
    requireCheckpoint(snapshot, step.checkpoint.text);
    verifyFields(snapshot, step, inputs);
  } else {
    await checkedCall(surface, "browser_handle_dialog", { accept: step.accept });
  }
  await evidence.record("step_completed", { id: step.id });
  return undefined;
}

function knownOutcome(snapshot: string, outcomes: KnownOutcome[]): KnownOutcome | undefined {
  return outcomes.find((outcome) => snapshot.includes(outcome.marker));
}

function resultForOutcome(outcome: Exclude<KnownOutcome, { classification: "recoverable" }>, stepId: string): ResultBody {
  if (outcome.classification === "business_outcome") {
    return { status: "business_outcome", code: outcome.code, message: outcome.message, stepId };
  }
  if (outcome.classification === "human_required") {
    return { status: "human_required", code: outcome.code, message: outcome.message, stepId };
  }
  return {
    status: "failure",
    failureKind: outcome.failureKind,
    code: outcome.code,
    message: outcome.message,
    stepId
  };
}

async function inspectKnownOutcomes(options: {
  artifact: CapabilityArtifact;
  surface: SurfaceClient;
  evidence: ReplayEvidenceRecorder;
  targetUrl: URL;
  inputs: Record<string, CapabilityValue>;
  completedSteps: string[];
  recoveries: Array<{ code: string; attempt: number; stepId: string }>;
  attempts: Map<string, number>;
  humanHandoffs: HumanHandoffRecord[];
  humanHandoff?: ReplayHumanHandoffOptions;
  stepId: string;
}): Promise<{ observed: boolean; result?: ResultBody }> {
  let observed = false;
  while (true) {
    const snapshot = await snapshotText(options.surface);
    const outcome = knownOutcome(snapshot, options.artifact.completion.outcomes);
    if (!outcome) return { observed };
    observed = true;
    await options.evidence.record("known_outcome_observed", {
      classification: outcome.classification,
      code: outcome.code,
      marker: outcome.marker,
      stepId: options.stepId
    });
    if (outcome.classification === "human_required") {
      const resumed = await tryHumanHandoff({
        outcome,
        surface: options.surface,
        evidence: options.evidence,
        inputs: options.inputs,
        handoff: options.humanHandoff,
        humanHandoffs: options.humanHandoffs
      });
      if (resumed) continue;
      return { observed, result: resultForOutcome(outcome, options.stepId) };
    }
    if (outcome.classification !== "recoverable") {
      return { observed, result: resultForOutcome(outcome, options.stepId) };
    }

    const attempt = (options.attempts.get(outcome.code) ?? 0) + 1;
    if (attempt > outcome.maxAttempts) {
      return {
        observed,
        result: {
          status: "failure",
          failureKind: "recoverable_exhausted",
          code: outcome.code,
          message: `${outcome.message} Recovery limit exhausted.`,
          stepId: outcome.recovery.id
        }
      };
    }
    options.attempts.set(outcome.code, attempt);
    options.recoveries.push({ code: outcome.code, attempt, stepId: outcome.recovery.id });
    await options.evidence.record("recovery_started", {
      code: outcome.code,
      attempt,
      maxAttempts: outcome.maxAttempts,
      stepId: outcome.recovery.id
    });
    const terminal = await executeStep({ ...options, step: outcome.recovery });
    if (terminal) return { observed, result: terminal };
    options.completedSteps.push(outcome.recovery.id);
  }
}

function extractOutputs(
  artifact: CapabilityArtifact,
  snapshot: string
): Record<string, CapabilityValue> {
  return Object.fromEntries(
    Object.entries(artifact.outputs).map(([name, spec]) => {
      let value: CapabilityValue = extractAccessibilityTableRow(snapshot, spec.extract.label);
      if (spec.extract.pattern) {
        const match = String(value).match(new RegExp(spec.extract.pattern));
        if (!match?.[1]) {
          throw new ReplayExecutionError(
            "ui_mismatch",
            `Output ${name} did not match its declared extraction pattern.`
          );
        }
        value = match[1];
      }
      if (spec.extract.visibleToValue) {
        const mapped = spec.extract.visibleToValue[String(value)];
        if (mapped === undefined) {
          throw new ReplayExecutionError(
            "ui_mismatch",
            `Output ${name} had no declared value mapping for ${JSON.stringify(value)}.`
          );
        }
        value = mapped;
      }
      if (spec.type === "number") value = numberFromVisible(String(value));
      return [name, value];
    })
  );
}

function assertOutputs(
  artifact: CapabilityArtifact,
  outputs: Record<string, CapabilityValue>,
  inputs: Record<string, CapabilityValue>
): void {
  for (const assertion of artifact.completion.assertions) {
    if (outputs[assertion.output] !== inputs[assertion.input]) {
      throw new ReplayExecutionError(
        "ui_mismatch",
        `Output ${assertion.output} did not match input ${assertion.input}.`
      );
    }
  }
}

async function evaluateCompletion(options: {
  artifact: CapabilityArtifact;
  surface: SurfaceClient;
  evidence: ReplayEvidenceRecorder;
  targetUrl: URL;
  inputs: Record<string, CapabilityValue>;
  completedSteps: string[];
  recoveries: Array<{ code: string; attempt: number; stepId: string }>;
  attempts: Map<string, number>;
  humanHandoffs: HumanHandoffRecord[];
  humanHandoff?: ReplayHumanHandoffOptions;
}): Promise<ResultBody> {
  while (true) {
    const snapshot = await snapshotText(options.surface);
    if (snapshot.includes(options.artifact.completion.checkpoint.text)) {
      const output = extractOutputs(options.artifact, snapshot);
      assertOutputs(options.artifact, output, options.inputs);
      await options.evidence.record("checkpoint_verified", {
        kind: options.artifact.completion.checkpoint.kind,
        text: options.artifact.completion.checkpoint.text
      });
      return { status: "success", output };
    }
    const inspected = await inspectKnownOutcomes({
      ...options,
      stepId: "verify_completion"
    });
    if (inspected.result) return inspected.result;
    if (inspected.observed) continue;
    throw new ReplayExecutionError(
      "ui_mismatch",
      "Neither the success checkpoint nor a declared outcome was visible."
    );
  }
}

export async function replayCapability(options: {
  artifact: CapabilityArtifact;
  inputs: Record<string, unknown>;
  targetUrl: string;
  surface: SurfaceClient;
  evidence: ReplayEvidenceRecorder;
  approveRisky?: boolean;
  humanHandoff?: ReplayHumanHandoffOptions;
  startedAt?: Date;
}): Promise<ReplayResult> {
  const startedAt = options.startedAt ?? new Date();
  const completedSteps: string[] = [];
  const recoveries: Array<{ code: string; attempt: number; stepId: string }> = [];
  const humanHandoffs: HumanHandoffRecord[] = [];
  const attempts = new Map<string, number>();
  let currentStep = "validate_request";
  let connected = false;
  let availableTools = new Set<string>();
  let body: ResultBody | undefined;

  try {
    const inputs = validateCapabilityInputs(options.artifact, options.inputs);
    const targetUrl = new URL(options.targetUrl);
    if (!options.artifact.surface.allowedOrigins.includes(targetUrl.origin)) {
      throw new ReplayExecutionError(
        "policy_denied",
        `Origin ${targetUrl.origin} is not approved for ${options.artifact.id}.`
      );
    }
    if (options.artifact.risk.requiresConfirmation && !options.approveRisky) {
      throw new ReplayExecutionError(
        "policy_denied",
        `Capability ${options.artifact.id} requires explicit risky-action confirmation.`
      );
    }

    await options.surface.connect();
    connected = true;
    availableTools = new Set((await options.surface.listTools()).map((tool) => tool.name));
    for (const action of options.artifact.risk.allowedActions) {
      const requiredTool = actionToTool[action];
      if (!availableTools.has(requiredTool)) {
        throw new ReplayExecutionError("surface_error", `Surface does not provide ${requiredTool}.`);
      }
    }
    if (options.artifact.risk.requiresConfirmation) {
      await options.evidence.record("risk_confirmation_verified", {
        level: options.artifact.risk.level,
        capabilityId: options.artifact.id
      });
    }

    for (const step of options.artifact.steps) {
      currentStep = step.id;
      if (completedSteps.length > 0 && step.action !== "handle_dialog") {
        const inspected = await inspectKnownOutcomes({
          artifact: options.artifact,
          surface: options.surface,
          evidence: options.evidence,
          targetUrl,
          inputs,
          completedSteps,
          recoveries,
          attempts,
          humanHandoffs,
          ...(options.humanHandoff ? { humanHandoff: options.humanHandoff } : {}),
          stepId: step.id
        });
        body = inspected.result;
        if (body) break;
      }
      body = await executeStep({
        artifact: options.artifact,
        surface: options.surface,
        evidence: options.evidence,
        targetUrl,
        inputs,
        step
      });
      if (body) break;
      completedSteps.push(step.id);
    }
    if (!body) {
      currentStep = "verify_completion";
      body = await evaluateCompletion({
        artifact: options.artifact,
        surface: options.surface,
        evidence: options.evidence,
        targetUrl,
        inputs,
        completedSteps,
        recoveries,
        attempts,
        humanHandoffs,
        ...(options.humanHandoff ? { humanHandoff: options.humanHandoff } : {})
      });
    }
  } catch (error) {
    const failure =
      error instanceof ReplayExecutionError
        ? error
        : error instanceof ArtifactValidationError
          ? new ReplayExecutionError("invalid_input", error.message)
          : error instanceof AccessibilityResolutionError
            ? new ReplayExecutionError("ui_mismatch", error.message)
            : new ReplayExecutionError(
                "surface_error",
                error instanceof Error ? error.message : String(error)
              );
    body = {
      status: "failure",
      failureKind: failure.failureKind,
      message: failure.message,
      stepId: currentStep,
      ...(failure.code ? { code: failure.code } : {})
    };
    await options.evidence.record("replay_failed", {
      failureKind: failure.failureKind,
      message: failure.message,
      stepId: currentStep,
      ...(failure.code ? { code: failure.code } : {})
    });
  }

  if (!body) {
    body = {
      status: "failure",
      failureKind: "surface_error",
      message: "Replay ended without a structured result.",
      stepId: currentStep
    };
  }

  if (
    connected &&
    (body.status === "failure" || body.status === "human_required") &&
    options.artifact.risk.allowedActions.includes("screenshot") &&
    availableTools.has("browser_take_screenshot")
  ) {
    const screenshotPath = options.evidence.failureScreenshotPath();
    try {
      const screenshot = await options.surface.callTool("browser_take_screenshot", {
        filename: screenshotPath,
        scale: "device"
      });
      if (!screenshot.isError) {
        body = { ...body, evidenceArtifact: options.evidence.evidenceFilename(screenshotPath) };
        await options.evidence.record("failure_evidence_captured", {
          filename: options.evidence.evidenceFilename(screenshotPath)
        });
      }
    } catch {
      await options.evidence.record("failure_evidence_capture_failed", { stepId: currentStep });
    }
  }

  if (connected) {
    try {
      await options.surface.close();
    } catch (error) {
      await options.evidence.record("surface_close_failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const finishedAt = new Date();
  const metadata: ReplayMetadata = {
    runId: options.evidence.runId,
    capabilityId: options.artifact.id,
    capabilityVersion: options.artifact.version,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    completedSteps,
    recoveries,
    humanHandoffs
  };
  const result = { ...metadata, ...body } as ReplayResult;
  await options.evidence.finish(result);
  return result;
}
