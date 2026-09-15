import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  SurfaceArguments,
  SurfaceClient,
  SurfaceTool,
  SurfaceToolResult
} from "../surface/types.js";
import { loadCapabilityArtifact, validateCapabilityArtifact } from "./artifact.js";
import { ReplayEvidenceRecorder } from "./evidence.js";
import { replayCapability } from "./executor.js";
import type { CapabilityArtifact } from "./types.js";

const artifactPath = new URL("../../capabilities/northstar.find-member.v1.json", import.meta.url);
const balanceArtifactPath = new URL(
  "../../capabilities/northstar.read-balance.v1.json",
  import.meta.url
);
const prepareArtifactPath = new URL(
  "../../capabilities/northstar.prepare-subaccount.v1.json",
  import.meta.url
);
const simulateArtifactPath = new URL(
  "../../capabilities/northstar.simulate-subaccount.v1.json",
  import.meta.url
);

function successSnapshot(memberNumber = "100042"): string {
  return `
- generic [ref=e1]:
  - text: Member Relationship Summary COREBANK / TELLER 7.4
  - table [ref=f2e2]:
    - row [ref=f2e4]:
      - rowheader "Member #" [ref=f2e5]
      - cell "${memberNumber}" [ref=f2e6]
      - rowheader "Status" [ref=f2e7]
      - cell "Active" [ref=f2e8]
    - row [ref=f2e9]:
      - rowheader "Name" [ref=f2e10]
      - cell "Avery Example" [ref=f2e11]
`;
}

class FakeSurface implements SurfaceClient {
  connected = false;
  closed = false;
  page = "blank";
  enteredMember = "";
  calls: Array<{ name: string; args: SurfaceArguments }> = [];
  private refNumber = 0;
  private targets = new Map<string, string>();

  constructor(private readonly resultPages: string[]) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async listTools(): Promise<SurfaceTool[]> {
    return [
      "browser_navigate",
      "browser_find",
      "browser_click",
      "browser_type",
      "browser_snapshot",
      "browser_take_screenshot"
    ].map((name) => ({ name, inputSchema: { type: "object" } }));
  }

  private targetFor(key: string): string {
    this.refNumber += 1;
    const target = `${key}-${this.refNumber}`;
    this.targets.set(key, target);
    return target;
  }

  async callTool(name: string, args: SurfaceArguments): Promise<SurfaceToolResult> {
    this.calls.push({ name, args });
    if (name === "browser_navigate") {
      this.page = "home";
      return { content: [{ type: "text", text: "navigated" }] };
    }
    if (name === "browser_snapshot") {
      const text =
        this.page === "home"
          ? "Operations Menu COREBANK / TELLER 7.4"
          : this.page === "search"
            ? "MBR-10 Member Inquiry COREBANK / TELLER 7.4"
            : this.resultPages[Number(this.page.slice(7))] ?? "Unknown page";
      return { content: [{ type: "text", text }] };
    }
    if (name === "browser_find") {
      const query = args.text;
      if (query === "MEMBER LOOKUP") {
        return {
          content: [
            { type: "text", text: `- link "MEMBER LOOKUP" [ref=${this.targetFor("lookup")}]` }
          ]
        };
      }
      if (query === "Member Number") {
        return {
          content: [
            {
              type: "text",
              text: `- text: Member Number\n- textbox [ref=${this.targetFor("member-input")}]`
            }
          ]
        };
      }
      if (query === "F6 - Locate") {
        return {
          content: [
            { type: "text", text: `- button "F6 - Locate" [ref=${this.targetFor("submit")}]` }
          ]
        };
      }
      if (query === "F5 - Retry host request") {
        return {
          content: [
            {
              type: "text",
              text: `- link "F5 - Retry host request" [ref=${this.targetFor("retry")}]`
            }
          ]
        };
      }
      return { isError: true, content: [{ type: "text", text: "not found" }] };
    }
    if (name === "browser_type") {
      assert.equal(args.target, this.targets.get("member-input"));
      this.enteredMember = String(args.text);
      return { content: [{ type: "text", text: "typed" }] };
    }
    if (name === "browser_click") {
      if (args.target === this.targets.get("lookup")) this.page = "search";
      else if (args.target === this.targets.get("submit")) this.page = "result-0";
      else if (args.target === this.targets.get("retry")) this.page = "result-1";
      else return { isError: true, content: [{ type: "text", text: "stale target" }] };
      return { content: [{ type: "text", text: "clicked" }] };
    }
    if (name === "browser_take_screenshot") {
      await writeFile(String(args.filename), "fake screenshot");
      return { content: [{ type: "text", text: "saved" }] };
    }
    return { isError: true };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function runWithPages(
  directory: string,
  artifact: CapabilityArtifact,
  pages: string[],
  memberNumber = "100042",
  targetUrl = "https://target-app-gamma.vercel.app/"
) {
  const surface = new FakeSurface(pages);
  const evidence = await ReplayEvidenceRecorder.create({
    rootDirectory: directory,
    artifact,
    inputs: { memberNumber },
    targetUrl,
    headless: true
  });
  const result = await replayCapability({
    artifact,
    inputs: { memberNumber },
    targetUrl,
    surface,
    evidence
  });
  return { result, surface, evidence };
}

test("the checked-in capability artifact is valid and reviewable", async () => {
  const artifact = await loadCapabilityArtifact(artifactPath.pathname);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.id, "northstar.find-member");
  assert.equal(artifact.version, "1.0.0");
  assert.equal(artifact.steps.length, 4);
  assert.equal(artifact.provenance.discoveryRunIds.length, 3);
  assert.throws(
    () => validateCapabilityArtifact({ ...artifact, schemaVersion: 2 }),
    /schema v1/
  );
});

test("every checked-in deterministic capability matches schema v1", async () => {
  const artifacts = await Promise.all(
    [artifactPath, balanceArtifactPath, prepareArtifactPath, simulateArtifactPath].map((url) =>
      loadCapabilityArtifact(url.pathname)
    )
  );
  assert.deepEqual(
    artifacts.map((artifact) => artifact.id),
    [
      "northstar.find-member",
      "northstar.read-balance",
      "northstar.prepare-subaccount",
      "northstar.simulate-subaccount"
    ]
  );
  const simulation = artifacts[3] as CapabilityArtifact;
  assert.throws(
    () =>
      validateCapabilityArtifact({
        ...simulation,
        risk: { ...simulation.risk, requiresConfirmation: false }
      }),
    /must require confirmation/
  );
  assert.throws(
    () =>
      validateCapabilityArtifact({
        ...simulation,
        risk: {
          ...simulation.risk,
          allowedActions: simulation.risk.allowedActions.filter((action) => action !== "verify")
        }
      }),
    /not allowed by the risk policy/
  );
});

test("replay resolves fresh refs, verifies the member, and redacts persisted output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-success-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const { result, surface, evidence } = await runWithPages(directory, artifact, [successSnapshot()]);
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(result.output, {
      memberNumber: "100042",
      displayedName: "Avery Example",
      memberStatus: "Active"
    });
    assert.equal(surface.enteredMember, "100042");
    assert.equal(surface.closed, true);
    assert.equal(surface.calls.some((call) => call.name.startsWith("model_")), false);

    const run = await readFile(join(evidence.runDirectory, "run.json"), "utf8");
    const summary = await readFile(join(evidence.runDirectory, "summary.json"), "utf8");
    assert.match(run, /"memberNumber": "\*\*\*0042"/);
    assert.match(summary, /"displayedName": "\[REDACTED\]"/);
    assert.doesNotMatch(summary, /Avery Example/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("member not found is a business outcome, not a crash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-business-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const { result } = await runWithPages(
      directory,
      artifact,
      ["MBR-10 Member Inquiry\nBUSINESS RESULT N04\nNo member relationship matched"],
      "999999"
    );
    assert.equal(result.status, "business_outcome", JSON.stringify(result));
    if (result.status === "business_outcome") assert.equal(result.code, "N04");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("T14 is retried once and the recovery is reported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-recovery-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const { result } = await runWithPages(directory, artifact, [
      "RECOVERABLE HOST CONDITION T14\nF5 - Retry host request",
      successSnapshot("100099")
    ], "100099");
    assert.equal(result.status, "success");
    assert.deepEqual(result.recoveries, [{ code: "T14", attempt: 1, stepId: "retry_member_lookup" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("T14 stops as recoverable_exhausted after its declared retry limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-recovery-limit-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const delayed = "RECOVERABLE HOST CONDITION T14\nF5 - Retry host request";
    const { result } = await runWithPages(directory, artifact, [delayed, delayed], "100099");
    assert.equal(result.status, "failure");
    if (result.status === "failure") {
      assert.equal(result.failureKind, "recoverable_exhausted");
      assert.equal(result.code, "T14");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("known hard and human-required states remain distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-outcomes-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const denied = await runWithPages(directory, artifact, ["Access Denied\nSECURITY S17"], "200017");
    assert.equal(denied.result.status, "failure");
    if (denied.result.status === "failure") {
      assert.equal(denied.result.failureKind, "permission_denied");
      assert.equal(denied.result.code, "S17");
      assert.equal(denied.result.evidenceArtifact, "failure.png");
    }

    const expired = await runWithPages(directory, artifact, ["Session Expired\nSESSION E01"], "EXPIRED");
    assert.equal(expired.result.status, "human_required");
    if (expired.result.status === "human_required") assert.equal(expired.result.code, "E01");

    const host = await runWithPages(directory, artifact, ["Host Error\nHOST X500"], "APP-500");
    assert.equal(host.result.status, "failure");
    if (host.result.status === "failure") {
      assert.equal(host.result.failureKind, "application_error");
      assert.equal(host.result.code, "X500");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid input and unapproved origins fail before browser connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-policy-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const invalid = await runWithPages(directory, artifact, [successSnapshot()], "");
    assert.equal(invalid.result.status, "failure");
    if (invalid.result.status === "failure") assert.equal(invalid.result.failureKind, "invalid_input");
    assert.equal(invalid.surface.connected, false);

    const origin = await runWithPages(
      directory,
      artifact,
      [successSnapshot()],
      "100042",
      "https://example.com/"
    );
    assert.equal(origin.result.status, "failure");
    if (origin.result.status === "failure") assert.equal(origin.result.failureKind, "policy_denied");
    assert.equal(origin.surface.connected, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an undeclared page is a debuggable UI mismatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-mismatch-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const { result } = await runWithPages(directory, artifact, ["Unexpected maintenance page"]);
    assert.equal(result.status, "failure");
    if (result.status === "failure") {
      assert.equal(result.failureKind, "ui_mismatch");
      assert.equal(result.stepId, "verify_completion");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the success checkpoint still fails if the page shows a different member", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-wrong-member-"));
  try {
    const artifact = await loadCapabilityArtifact(artifactPath.pathname);
    const { result } = await runWithPages(directory, artifact, [successSnapshot("999999")]);
    assert.equal(result.status, "failure");
    if (result.status === "failure") {
      assert.equal(result.failureKind, "ui_mismatch");
      assert.match(result.message, /did not match input/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

type WorkflowMode = "normal" | "missing_account" | "validation" | "hold" | "review_mismatch";

class WorkflowSurface implements SurfaceClient {
  connected = false;
  closed = false;
  page = "blank";
  finalClicked = false;
  supervisorClicked = false;
  calls: Array<{ name: string; args: SurfaceArguments }> = [];
  private lastQuery = "";

  constructor(private readonly mode: WorkflowMode = "normal") {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async listTools(): Promise<SurfaceTool[]> {
    return [
      "browser_navigate",
      "browser_find",
      "browser_click",
      "browser_type",
      "browser_select_option",
      "browser_snapshot",
      "browser_handle_dialog",
      "browser_take_screenshot"
    ].map((name) => ({ name, inputSchema: { type: "object" } }));
  }

  private snapshot(): string {
    if (this.page === "home") return "Operations Menu COREBANK / TELLER 7.4";
    if (this.page === "search") return "MBR-10 Member Inquiry COREBANK / TELLER 7.4";
    if (this.page === "member") {
      return `Member Relationship Summary
- table:
  - row:
    - cell "S-0042-01" [ref=account-cell]
    - cell "Regular Savings" [ref=product-cell]
    - link "INQUIRE" [ref=inquire]
  - button "F9 - Open New Share/Sub-account" [ref=open-sub]`;
    }
    if (this.page === "account") {
      return `Account Balance Inquiry
- row:
  - rowheader "Member" [ref=h1]
  - cell "100042 — Avery Example" [ref=c1]
- row:
  - rowheader "Account" [ref=h2]
  - cell "S-0042-01" [ref=c2]
- row:
  - rowheader "Product" [ref=h3]
  - cell "Regular Savings" [ref=c3]
- row:
  - rowheader "Ledger balance" [ref=h4]
  - cell "$2,481.37" [ref=c4]
- row:
  - rowheader "Available balance" [ref=h5]
  - cell "$2,381.37" [ref=c5]`;
    }
    if (this.page === "form") return "ACCT-22 New Share/Sub-account";
    if (this.page === "validation") return "VALIDATION V22\nOpening deposit must be non-negative";
    if (this.page === "hold") {
      return 'HUMAN REVIEW REQUIRED — HOLD H91\n- button "Supervisor: acknowledge review" [ref=supervisor]';
    }
    if (this.page === "review") {
      const nickname = this.mode === "review_mismatch" ? "Wrong value" : "Emergency Fund";
      return `REVIEW CHECKPOINT
- row:
  - rowheader "Member" [ref=rh1]
  - cell "100042 — Avery Example" [ref=rc1]
- row:
  - rowheader "Product" [ref=rh2]
  - cell "S01 - Regular Savings" [ref=rc2]
- row:
  - rowheader "Nickname" [ref=rh3]
  - cell "${nickname}" [ref=rc3]
- row:
  - rowheader "Opening deposit" [ref=rh4]
  - cell "CAD 40.00" [ref=rc4]
- row:
  - rowheader "Statements" [ref=rh5]
  - cell "Paper" [ref=rc5]
- button "SIMULATE FINAL SUBMISSION" [ref=simulate]`;
    }
    if (this.page === "receipt") {
      return `SIMULATED SUCCESS
- row:
  - rowheader "Training reference" [ref=th1]
  - cell "TRAIN-100042-004000" [ref=tc1]
- row:
  - rowheader "Result" [ref=th2]
  - cell "Review flow completed in safe simulation mode" [ref=tc2]`;
    }
    return "blank";
  }

  async callTool(name: string, args: SurfaceArguments): Promise<SurfaceToolResult> {
    this.calls.push({ name, args });
    if (name === "browser_navigate") {
      this.page = "home";
      return { content: [{ type: "text", text: "navigated" }] };
    }
    if (name === "browser_snapshot") {
      return { content: [{ type: "text", text: this.snapshot() }] };
    }
    if (name === "browser_find") {
      this.lastQuery = String(args.text);
      if (this.lastQuery === "S-0042-01" && this.mode === "missing_account") {
        return { isError: true, content: [{ type: "text", text: "not found" }] };
      }
      const results: Record<string, string> = {
        "MEMBER LOOKUP": '- link "MEMBER LOOKUP" [ref=lookup]',
        "Member Number": '- text: Member Number\n- textbox [ref=member-input]',
        "F6 - Locate": '- button "F6 - Locate" [ref=locate]',
        "S-0042-01": this.snapshot(),
        "F9 - Open New Share/Sub-account":
          '- button "F9 - Open New Share/Sub-account" [ref=open-sub]',
        "Product Code": '- text: Product Code\n- combobox [ref=product]',
        "Account Nickname": '- text: Account Nickname\n- textbox [ref=nickname]',
        "Opening Deposit (CAD)": '- text: Opening Deposit (CAD)\n- textbox [ref=deposit]',
        Electronic: '- radio "Electronic" [ref=electronic]',
        Paper: '- radio "Paper" [ref=paper]',
        "F8 - Continue to Review": '- button "F8 - Continue to Review" [ref=continue]',
        "SIMULATE FINAL SUBMISSION": '- button "SIMULATE FINAL SUBMISSION" [ref=simulate]',
        "Supervisor: acknowledge review":
          '- button "Supervisor: acknowledge review" [ref=supervisor]'
      };
      const text = results[this.lastQuery];
      return text
        ? { content: [{ type: "text", text }] }
        : { isError: true, content: [{ type: "text", text: "not found" }] };
    }
    if (name === "browser_click") {
      const target = String(args.target);
      if (target === "lookup") this.page = "search";
      else if (target === "locate") this.page = "member";
      else if (target === "inquire") this.page = "account";
      else if (target === "open-sub") this.page = "form";
      else if (target === "electronic" || target === "paper") {
        // The fake records the deterministic choice; the page stays on the form.
      }
      else if (target === "continue") {
        this.page = this.mode === "validation" ? "validation" : this.mode === "hold" ? "hold" : "review";
      } else if (target === "supervisor") {
        this.supervisorClicked = true;
        this.page = "review";
      } else if (target === "simulate") {
        this.finalClicked = true;
        return {
          content: [
            {
              type: "text",
              text: "TRAINING ONLY: simulate the final submission? No real account will be created."
            }
          ]
        };
      } else return { isError: true, content: [{ type: "text", text: "stale target" }] };
      return { content: [{ type: "text", text: "clicked" }] };
    }
    if (name === "browser_type" || name === "browser_select_option") {
      return { content: [{ type: "text", text: "set" }] };
    }
    if (name === "browser_handle_dialog") {
      this.page = "receipt";
      return { content: [{ type: "text", text: "accepted" }] };
    }
    if (name === "browser_take_screenshot") {
      await writeFile(String(args.filename), "fake screenshot");
      return { content: [{ type: "text", text: "saved" }] };
    }
    return { isError: true };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function runWorkflow(options: {
  directory: string;
  artifact: CapabilityArtifact;
  inputs: Record<string, string | number>;
  mode?: WorkflowMode;
  approveRisky?: boolean;
  approveHuman?: boolean;
}) {
  const surface = new WorkflowSurface(options.mode);
  const targetUrl = "https://target-app-gamma.vercel.app/";
  const evidence = await ReplayEvidenceRecorder.create({
    rootDirectory: options.directory,
    artifact: options.artifact,
    inputs: options.inputs,
    targetUrl,
    headless: true
  });
  const result = await replayCapability({
    artifact: options.artifact,
    inputs: options.inputs,
    targetUrl,
    surface,
    evidence,
    ...(options.approveRisky ? { approveRisky: true } : {}),
    ...(options.approveHuman
      ? {
          humanHandoff: {
            enabled: true,
            timeoutMs: 100,
            pollIntervalMs: 1,
            requestDecision: async () => "approved" as const
          }
        }
      : {})
  });
  return { result, surface };
}

const subaccountInputs = {
  memberNumber: "100042",
  product: "REGULAR_SAVINGS",
  nickname: "Emergency Fund",
  openingDeposit: 40,
  statementDelivery: "PAPER"
};

test("balance replay scopes INQUIRE to the requested account row and extracts numbers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-balance-"));
  try {
    const artifact = await loadCapabilityArtifact(balanceArtifactPath.pathname);
    const { result, surface } = await runWorkflow({
      directory,
      artifact,
      inputs: { memberNumber: "100042", accountNumber: "S-0042-01" }
    });
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.output.availableBalance, 2381.37);
      assert.equal(result.output.accountNumber, "S-0042-01");
    }
    assert.equal(
      surface.calls.some(
        (call) => call.name === "browser_find" && call.args.text === "S-0042-01"
      ),
      true
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prepare replay returns validation as a business outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-prepare-validation-"));
  try {
    const artifact = await loadCapabilityArtifact(prepareArtifactPath.pathname);
    const { result } = await runWorkflow({
      directory,
      artifact,
      inputs: { ...subaccountInputs, openingDeposit: -5 },
      mode: "validation"
    });
    assert.equal(result.status, "business_outcome", JSON.stringify(result));
    if (result.status === "business_outcome") assert.equal(result.code, "V22");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("simulated final submission requires confirmation before connecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-risk-"));
  try {
    const artifact = await loadCapabilityArtifact(simulateArtifactPath.pathname);
    const { result, surface } = await runWorkflow({ directory, artifact, inputs: subaccountInputs });
    assert.equal(result.status, "failure");
    if (result.status === "failure") assert.equal(result.failureKind, "policy_denied");
    assert.equal(surface.connected, false);
    assert.equal(surface.finalClicked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review mismatch prevents the final action even after confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-review-mismatch-"));
  try {
    const artifact = await loadCapabilityArtifact(simulateArtifactPath.pathname);
    const { result, surface } = await runWorkflow({
      directory,
      artifact,
      inputs: subaccountInputs,
      mode: "review_mismatch",
      approveRisky: true
    });
    assert.equal(result.status, "failure");
    if (result.status === "failure") {
      assert.equal(result.failureKind, "ui_mismatch", JSON.stringify(result));
    }
    assert.equal(surface.finalClicked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("confirmed simulation verifies review, accepts its dialog, and returns receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-simulate-"));
  try {
    const artifact = await loadCapabilityArtifact(simulateArtifactPath.pathname);
    const { result, surface } = await runWorkflow({
      directory,
      artifact,
      inputs: subaccountInputs,
      approveRisky: true
    });
    assert.equal(result.status, "success", JSON.stringify(result));
    if (result.status === "success") {
      assert.equal(result.output.trainingReference, "TRAIN-100042-004000");
    }
    assert.equal(surface.finalClicked, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an approved H91 handoff resumes in the same surface session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-handoff-"));
  try {
    const artifact = await loadCapabilityArtifact(simulateArtifactPath.pathname);
    const { result, surface } = await runWorkflow({
      directory,
      artifact,
      inputs: subaccountInputs,
      mode: "hold",
      approveRisky: true,
      approveHuman: true
    });
    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(surface.supervisorClicked, true);
    assert.equal(surface.finalClicked, true);
    assert.equal(result.humanHandoffs.length, 1);
    assert.equal(result.humanHandoffs[0]?.code, "H91");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
