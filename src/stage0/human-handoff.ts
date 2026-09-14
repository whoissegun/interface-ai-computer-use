import type { BrowserClient, BrowserToolResult, Scenario } from "./types.js";
import { EvidenceRecorder } from "./evidence.js";

export type LiveHumanHandoffOptions = {
  browserClient: BrowserClient;
  evidence: EvidenceRecorder;
  scenario: Scenario;
  timeoutMs: number;
  pollIntervalMs: number;
  requestDecision?: (signal: AbortSignal) => Promise<"approved" | "rejected">;
  onProgress?: (message: string) => void;
};

export type HumanHandoffResult = {
  reasonCode: string;
  status: "resumed";
  requestedAt: string;
  resolvedAt: string;
  checks: number;
};

function textFromResult(result: BrowserToolResult): string {
  return (result.content ?? [])
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const block = item as Record<string, unknown>;
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    })
    .join("\n");
}

async function snapshotText(browserClient: BrowserClient): Promise<string> {
  const result = await browserClient.callTool("browser_snapshot", {});
  if (result.isError) throw new Error("Playwright could not inspect the browser during human handoff.");
  return textFromResult(result);
}

function supervisorButtonTarget(snapshot: string): string | null {
  const line = snapshot
    .split("\n")
    .find((candidate) => /button .*Supervisor: acknowledge review/i.test(candidate));
  return line?.match(/\[ref=([^\]]+)\]/)?.[1] ?? null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForHumanHandoff(
  options: LiveHumanHandoffOptions
): Promise<HumanHandoffResult> {
  const handoff = options.scenario.humanHandoff;
  if (!handoff) throw new Error(`Scenario ${options.scenario.id} has no human-handoff definition.`);

  const initialText = await snapshotText(options.browserClient);
  if (!initialText.includes(handoff.triggerText)) {
    await options.evidence.record("human_handoff_trigger_missing", {
      reasonCode: handoff.reasonCode,
      expectedText: handoff.triggerText
    });
    throw new Error(
      `Expected human handoff ${handoff.reasonCode}, but its hold was not visible when the model stopped.`
    );
  }

  const requestedAt = new Date().toISOString();
  await options.evidence.record("human_handoff_required", {
    reasonCode: handoff.reasonCode,
    instructions: handoff.instructions,
    resumeCondition: handoff.resolvedText,
    requestedAt
  });
  options.onProgress?.(`NEEDS HUMAN — ${handoff.reasonCode}`);
  options.onProgress?.(handoff.instructions);
  options.onProgress?.("The browser session will remain open while the harness waits.");

  const deadline = Date.now() + options.timeoutMs;
  if (options.requestDecision) {
    const buttonTarget = supervisorButtonTarget(initialText);
    if (!buttonTarget) {
      throw new Error("The H91 hold is visible, but its supervisor acknowledgement button has no usable ref.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let decision: "approved" | "rejected";
    try {
      decision = await options.requestDecision(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        await options.evidence.record("human_handoff_timed_out", {
          reasonCode: handoff.reasonCode,
          timeoutMs: options.timeoutMs,
          checks: 1
        });
        throw new Error(`Human handoff ${handoff.reasonCode} timed out after ${options.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    await options.evidence.record("human_handoff_decision", {
      reasonCode: handoff.reasonCode,
      decision
    });
    if (decision === "rejected") {
      throw new Error(`Human rejected handoff ${handoff.reasonCode}; no supervisor action was performed.`);
    }

    options.onProgress?.(`Human approved ${handoff.reasonCode}; applying the authorized acknowledgement.`);
    const action = await options.browserClient.callTool("browser_click", {
      element: "Supervisor: acknowledge review",
      target: buttonTarget
    });
    await options.evidence.record("human_handoff_action_result", {
      reasonCode: handoff.reasonCode,
      result: action
    });
    if (action.isError) {
      const detail = textFromResult(action).trim();
      throw new Error(
        `The approved supervisor acknowledgement could not be applied${detail ? `: ${detail}` : "."}`
      );
    }
    await options.evidence.record("human_handoff_action_applied", {
      reasonCode: handoff.reasonCode,
      toolName: "browser_click",
      element: "Supervisor: acknowledge review",
      target: buttonTarget
    });
  }

  let checks = 1;
  while (Date.now() < deadline) {
    await wait(Math.min(options.pollIntervalMs, Math.max(0, deadline - Date.now())));
    const currentText = await snapshotText(options.browserClient);
    checks += 1;
    const holdVisible = currentText.includes(handoff.triggerText);
    const resumeVisible = currentText.includes(handoff.resolvedText);
    if (!holdVisible && resumeVisible) {
      const resolvedAt = new Date().toISOString();
      await options.evidence.record("human_handoff_resume_observed", {
        reasonCode: handoff.reasonCode,
        holdVisible,
        resumeVisible,
        snapshot: currentText
      });
      const result: HumanHandoffResult = {
        reasonCode: handoff.reasonCode,
        status: "resumed",
        requestedAt,
        resolvedAt,
        checks
      };
      await options.evidence.record("human_handoff_resumed", result);
      options.onProgress?.(`Human handoff ${handoff.reasonCode} completed; resume condition verified.`);
      return result;
    }
  }

  await options.evidence.record("human_handoff_timed_out", {
    reasonCode: handoff.reasonCode,
    timeoutMs: options.timeoutMs,
    checks
  });
  throw new Error(`Human handoff ${handoff.reasonCode} timed out after ${options.timeoutMs} ms.`);
}
