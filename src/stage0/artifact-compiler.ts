import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { validateCapabilityArtifact } from "../replay/artifact.js";
import type { CapabilityArtifact, ReplayStep } from "../replay/types.js";

type JsonObject = Record<string, unknown>;

type StoredEvent = {
  sequence: number;
  type: string;
  data: unknown;
};

type RecordedToolCall = {
  callNumber: number;
  toolName: string;
  arguments: JsonObject;
};

export type ArtifactCompilationReport = {
  schemaVersion: 1;
  kind: "discovery_artifact_compilation";
  status: "compiled";
  compilerProfile: "northstar.find-member@1";
  sourceRunId: string;
  sourceScenario: "a1";
  sourceTargetOrigin: string;
  recognizedActions: Array<{
    callNumber: number;
    toolName: string;
    compiledAction: ReplayStep["action"];
  }>;
  ignoredObservationCalls: Array<{ callNumber: number; toolName: string }>;
  validation: "passed";
  ephemeralTargetsPersisted: false;
  sampleInputValuesPersisted: false;
};

export type ArtifactCompilation = {
  artifact: CapabilityArtifact;
  report: ArtifactCompilationReport;
};

const observationTools = new Set([
  "browser_snapshot",
  "browser_wait_for",
  "browser_take_screenshot",
  "browser_find",
  "browser_tabs",
  "browser_resize"
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value: unknown, field: string): JsonObject {
  if (!isObject(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

async function readJson(path: string): Promise<JsonObject> {
  return requireObject(JSON.parse(await readFile(path, "utf8")) as unknown, basename(path));
}

async function readEvents(path: string): Promise<StoredEvent[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      const event = requireObject(JSON.parse(line) as unknown, `events line ${index + 1}`);
      return {
        sequence: requireNumber(event.sequence, `events line ${index + 1}.sequence`),
        type: requireString(event.type, `events line ${index + 1}.type`),
        data: event.data
      };
    });
}

function recordedToolCalls(events: StoredEvent[]): RecordedToolCall[] {
  return events
    .filter((event) => event.type === "tool_requested")
    .map((event) => {
      const data = requireObject(event.data, `event ${event.sequence}.data`);
      return {
        callNumber: requireNumber(
          data.toolCallNumber,
          `event ${event.sequence}.data.toolCallNumber`
        ),
        toolName: requireString(data.toolName, `event ${event.sequence}.data.toolName`),
        arguments: requireObject(data.arguments, `event ${event.sequence}.data.arguments`)
      };
    });
}

function expectTool(
  call: RecordedToolCall | undefined,
  toolName: string,
  elementPattern?: RegExp
): RecordedToolCall {
  if (!call || call.toolName !== toolName) {
    throw new Error(
      `The a1 compiler expected ${toolName}, but observed ${call?.toolName ?? "no action"}.`
    );
  }
  if (elementPattern) {
    const element = requireString(call.arguments.element, `${toolName}.element`);
    if (!elementPattern.test(element)) {
      throw new Error(`${toolName} targeted an unrecognized element: ${element}`);
    }
  }
  return call;
}

function accessibleName(element: string, suffix: RegExp): string {
  const name = element.replace(suffix, "").trim();
  if (!name) throw new Error(`Could not derive a stable accessible name from ${element}.`);
  return name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberInputElement(call: RecordedToolCall, events: StoredEvent[]): string {
  if (typeof call.arguments.element === "string" && call.arguments.element.trim()) {
    const element = call.arguments.element;
    if (!/member number.*textbox/i.test(element)) {
      throw new Error(`browser_type targeted an unrecognized element: ${element}`);
    }
    return element;
  }

  // Playwright MCP's human-readable `element` hint is optional. If it is
  // absent, accept only the exact target ref previously observed beside the
  // reviewed Member Number label. The ref is used as trace evidence only and
  // is never persisted into the capability.
  const target = requireString(
    call.arguments.target ?? call.arguments.ref,
    "browser_type.target"
  );
  const priorObservations = JSON.stringify(
    events
      .filter((event) => {
        if (event.type !== "tool_result" || !isObject(event.data)) return false;
        const observedCallNumber = event.data.toolCallNumber;
        return typeof observedCallNumber === "number" && observedCallNumber < call.callNumber;
      })
      .map((event) => event.data)
  );
  const recordedTextbox = new RegExp(
    `text:\\s*Member Number[\\s\\S]{0,300}textbox \\[ref=${escapeRegExp(target)}\\]`,
    "i"
  );
  if (!recordedTextbox.test(priorObservations)) {
    throw new Error(
      "browser_type omitted its element hint and its target was not the recorded Member Number textbox."
    );
  }
  return "Member Number textbox";
}

function observedText(events: StoredEvent[]): string {
  return JSON.stringify(
    events.filter((event) => event.type === "tool_result").map((event) => event.data)
  );
}

export function supportsArtifactCompilation(scenarioId: string): boolean {
  return scenarioId === "a1";
}

export async function buildCapabilityFromDiscoveryRun(
  runDirectory: string
): Promise<ArtifactCompilation> {
  const absoluteRunDirectory = resolve(runDirectory);
  const [run, summary, events] = await Promise.all([
    readJson(join(absoluteRunDirectory, "run.json")),
    readJson(join(absoluteRunDirectory, "summary.json")),
    readEvents(join(absoluteRunDirectory, "events.ndjson"))
  ]);

  const runId = requireString(run.runId, "run.runId");
  const scenario = requireObject(run.scenario, "run.scenario");
  const scenarioId = requireString(scenario.id, "run.scenario.id");
  if (!supportsArtifactCompilation(scenarioId)) {
    throw new Error(`No reviewed artifact compiler profile exists for scenario ${scenarioId}.`);
  }
  if (summary.runId !== runId || summary.scenarioId !== scenarioId) {
    throw new Error("The discovery run and summary identities do not match.");
  }
  if (summary.status !== "completed") {
    throw new Error(`Only a completed discovery run can produce an artifact; got ${summary.status}.`);
  }

  const targetUrl = new URL(requireString(run.targetUrl, "run.targetUrl"));
  const calls = recordedToolCalls(events);
  const ignoredObservationCalls = calls
    .filter((call) => observationTools.has(call.toolName))
    .map((call) => ({ callNumber: call.callNumber, toolName: call.toolName }));
  const actions = calls.filter((call) => !observationTools.has(call.toolName));
  if (actions.length !== 4) {
    throw new Error(
      `The a1 compiler requires exactly four recognized business actions; observed ${actions.length}.`
    );
  }

  const navigate = expectTool(actions[0], "browser_navigate");
  const openLookup = expectTool(actions[1], "browser_click", /member lookup.*link/i);
  const enterMember = expectTool(actions[2], "browser_type");
  const submitLookup = expectTool(actions[3], "browser_click", /f6\s*-\s*locate.*button/i);

  const navigatedUrl = new URL(requireString(navigate.arguments.url, "browser_navigate.url"));
  if (navigatedUrl.origin !== targetUrl.origin) {
    throw new Error("The recorded navigation left the discovery run's approved target origin.");
  }
  requireString(enterMember.arguments.text, "browser_type.text");

  const observations = observedText(events);
  const completionText = "Member Relationship Summary";
  if (!observations.includes(completionText)) {
    throw new Error(`The recorded browser observations never showed ${completionText}.`);
  }
  const applicationVersion = observations.match(/COREBANK\s*\/\s*TELLER\s+([0-9.]+)/i)?.[1];
  if (!applicationVersion) {
    throw new Error("The recorded browser observations did not identify the application version.");
  }

  const lookupElement = requireString(openLookup.arguments.element, "open lookup element");
  const memberElement = memberInputElement(enterMember, events);
  const submitElement = requireString(submitLookup.arguments.element, "submit lookup element");
  const steps: ReplayStep[] = [
    {
      id: "open_application",
      action: "navigate",
      path: `${navigatedUrl.pathname}${navigatedUrl.search}`,
      expect: { kind: "visible_text", text: "Operations Menu" }
    },
    {
      id: "open_member_lookup",
      action: "click",
      locator: {
        kind: "accessibility",
        role: "link",
        name: accessibleName(lookupElement, /(?:\s+navigation)?\s+link$/i),
        exact: true,
        rationale:
          "Compiled from the recorded operator-facing link name; temporary Playwright refs are deliberately discarded and resolved fresh during replay."
      },
      expect: { kind: "visible_text", text: "MBR-10 Member Inquiry" }
    },
    {
      id: "enter_member_number",
      action: "type",
      locator: {
        kind: "accessibility",
        role: "textbox",
        nearText: accessibleName(memberElement, /\s+textbox$/i),
        exact: true,
        rationale:
          "Compiled from the visible label next to the legacy textbox because the control has no programmatic name."
      },
      input: "memberNumber"
    },
    {
      id: "submit_member_lookup",
      action: "click",
      locator: {
        kind: "accessibility",
        role: "button",
        name: accessibleName(submitElement, /\s+button$/i),
        exact: true,
        rationale:
          "Compiled from the unique function-key caption observed during the successful discovery run."
      }
    }
  ];

  const artifact = validateCapabilityArtifact({
    schemaVersion: 1,
    kind: "computer_use_capability",
    id: "northstar.find-member",
    version: "1.0.0",
    name: "Find a Northstar member",
    description:
      "Find a member relationship by its exact member number and return the displayed identity summary.",
    provenance: {
      discoveryScenario: scenarioId,
      discoveryRunIds: [runId],
      compiledBy: "reviewed_trace_compiler"
    },
    surface: {
      kind: "web_accessibility",
      application: "northstar-corebank",
      applicationVersion,
      allowedOrigins: [targetUrl.origin]
    },
    risk: {
      level: "read_only",
      requiresConfirmation: false,
      allowedActions: ["navigate", "find", "click", "type", "snapshot", "screenshot"]
    },
    inputs: {
      memberNumber: {
        type: "string",
        description: "Exact member number shown in CoreBank, up to 16 letters, digits, or hyphens.",
        minLength: 1,
        maxLength: 16,
        pattern: "^[A-Za-z0-9-]+$",
        logPolicy: "last4"
      }
    },
    outputs: {
      memberNumber: {
        type: "string",
        description: "Member number confirmed on the relationship summary.",
        extract: { kind: "accessibility_table_row", label: "Member #" },
        logPolicy: "last4"
      },
      displayedName: {
        type: "string",
        description: "Member name displayed by CoreBank.",
        extract: { kind: "accessibility_table_row", label: "Name" },
        logPolicy: "redact"
      },
      memberStatus: {
        type: "string",
        description: "Relationship status displayed by CoreBank.",
        extract: { kind: "accessibility_table_row", label: "Status" },
        logPolicy: "plain"
      }
    },
    steps,
    completion: {
      checkpoint: { kind: "visible_text", text: completionText },
      outcomes: [
        {
          classification: "business_outcome",
          code: "N04",
          marker: "BUSINESS RESULT N04",
          message: "No member relationship matched the supplied member number."
        },
        {
          classification: "recoverable",
          code: "T14",
          marker: "RECOVERABLE HOST CONDITION T14",
          message: "The relationship index timed out; retry the same inquiry once.",
          maxAttempts: 1,
          recovery: {
            id: "retry_member_lookup",
            action: "click",
            locator: {
              kind: "accessibility",
              role: "link",
              name: "F5 - Retry host request",
              exact: true,
              rationale:
                "The reviewed compiler profile permits only the dedicated retry link that preserves member context."
            }
          }
        },
        {
          classification: "failure",
          code: "S17",
          marker: "SECURITY S17",
          failureKind: "permission_denied",
          message: "The operator is not permitted to view this relationship."
        },
        {
          classification: "human_required",
          code: "E01",
          marker: "SESSION E01",
          message: "The session expired and a human operator must sign in again."
        },
        {
          classification: "failure",
          code: "X500",
          marker: "HOST X500",
          failureKind: "application_error",
          message: "CoreBank returned an unrecoverable host failure."
        }
      ],
      assertions: [
        { kind: "output_equals_input", output: "memberNumber", input: "memberNumber" }
      ]
    }
  });

  return {
    artifact,
    report: {
      schemaVersion: 1,
      kind: "discovery_artifact_compilation",
      status: "compiled",
      compilerProfile: "northstar.find-member@1",
      sourceRunId: runId,
      sourceScenario: "a1",
      sourceTargetOrigin: targetUrl.origin,
      recognizedActions: actions.map((call, index) => ({
        callNumber: call.callNumber,
        toolName: call.toolName,
        compiledAction: steps[index]!.action
      })),
      ignoredObservationCalls,
      validation: "passed",
      ephemeralTargetsPersisted: false,
      sampleInputValuesPersisted: false
    }
  };
}

export async function compileDiscoveryRun(options: {
  runDirectory: string;
  outputPath?: string;
}): Promise<ArtifactCompilation & { artifactPath: string; reportPath: string }> {
  const runDirectory = resolve(options.runDirectory);
  const compilation = await buildCapabilityFromDiscoveryRun(runDirectory);
  const artifactPath = resolve(options.outputPath ?? join(runDirectory, "capability.json"));
  const reportPath = join(runDirectory, "artifact-compilation.json");
  await mkdir(dirname(artifactPath), { recursive: true });
  await Promise.all([
    writeFile(artifactPath, `${JSON.stringify(compilation.artifact, null, 2)}\n`),
    writeFile(
      reportPath,
      `${JSON.stringify(
        {
          ...compilation.report,
          artifactPath: relative(runDirectory, artifactPath) || basename(artifactPath)
        },
        null,
        2
      )}\n`
    )
  ]);
  return { ...compilation, artifactPath, reportPath };
}
