export type CapabilityValue = string | number | boolean;

export type AccessibilityRole = "link" | "button" | "textbox" | "combobox" | "radio";

export type AccessibilityLocator = {
  kind: "accessibility";
  role: AccessibilityRole;
  name?: string;
  nearText?: string;
  withinRowInput?: string;
  exact: boolean;
  rationale: string;
};

export type VisibleTextCheckpoint = {
  kind: "visible_text";
  text: string;
};

export type NavigateStep = {
  id: string;
  action: "navigate";
  path: string;
  expect: VisibleTextCheckpoint;
};

export type ClickStep = {
  id: string;
  action: "click";
  locator: AccessibilityLocator;
  expect?: VisibleTextCheckpoint;
  expectDialogText?: string;
  onMissing?: {
    classification: "business_outcome";
    code: string;
    message: string;
  };
};

export type TypeStep = {
  id: string;
  action: "type";
  locator: AccessibilityLocator;
  input: string;
};

export type SelectOptionStep = {
  id: string;
  action: "select_option";
  locator: AccessibilityLocator;
  input: string;
  options: Record<string, string>;
};

export type ClickChoiceStep = {
  id: string;
  action: "click_choice";
  input: string;
  choices: Record<string, AccessibilityLocator>;
};

export type VerifyStep = {
  id: string;
  action: "verify";
  checkpoint: VisibleTextCheckpoint;
  fields: Array<{
    label: string;
    input: string;
    comparison: "exact" | "starts_with" | "number";
    inputToVisible?: Record<string, string>;
  }>;
};

export type HandleDialogStep = {
  id: string;
  action: "handle_dialog";
  accept: true;
};

export type ReplayStep =
  | NavigateStep
  | ClickStep
  | TypeStep
  | SelectOptionStep
  | ClickChoiceStep
  | VerifyStep
  | HandleDialogStep;

export type StringInputSpec = {
  type: "string";
  description: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  logPolicy: "plain" | "last4" | "redact";
};

export type NumberInputSpec = {
  type: "number";
  description: string;
  minimum?: number;
  maximum?: number;
  logPolicy: "plain" | "last4" | "redact";
};

export type InputSpec = StringInputSpec | NumberInputSpec;

export type OutputSpec = {
  type: "string" | "number";
  description: string;
  extract: {
    kind: "accessibility_table_row";
    label: string;
    pattern?: string;
    visibleToValue?: Record<string, string>;
    numberFormat?: "currency";
  };
  logPolicy: "plain" | "last4" | "redact";
};

export type BusinessOutcome = {
  classification: "business_outcome";
  code: string;
  marker: string;
  message: string;
};

export type HumanOutcome = {
  classification: "human_required";
  code: string;
  marker: string;
  message: string;
  handoff?: {
    instructions: string;
    resumeCheckpoint: VisibleTextCheckpoint;
    authorizedAction?: AccessibilityLocator;
  };
};

export type FailureOutcome = {
  classification: "failure";
  code: string;
  marker: string;
  failureKind: "permission_denied" | "application_error";
  message: string;
};

export type RecoverableOutcome = {
  classification: "recoverable";
  code: string;
  marker: string;
  message: string;
  maxAttempts: number;
  recovery: ClickStep;
};

export type KnownOutcome = BusinessOutcome | HumanOutcome | FailureOutcome | RecoverableOutcome;

export type CapabilityArtifact = {
  $schema?: string;
  schemaVersion: 1;
  kind: "computer_use_capability";
  id: string;
  version: string;
  name: string;
  description: string;
  provenance: {
    discoveryScenario: string;
    discoveryRunIds: string[];
    compiledBy: "human_reviewed" | "reviewed_trace_compiler";
  };
  surface: {
    kind: "web_accessibility";
    application: string;
    applicationVersion: string;
    allowedOrigins: string[];
  };
  risk: {
    level: "read_only" | "reversible_write" | "simulated_irreversible";
    requiresConfirmation: boolean;
    allowedActions: Array<ReplayStep["action"] | "snapshot" | "find" | "screenshot">;
  };
  inputs: Record<string, InputSpec>;
  outputs: Record<string, OutputSpec>;
  steps: ReplayStep[];
  completion: {
    checkpoint: VisibleTextCheckpoint;
    outcomes: KnownOutcome[];
    assertions: Array<{
      kind: "output_equals_input";
      output: string;
      input: string;
    }>;
  };
};

export type RecoveryRecord = {
  code: string;
  attempt: number;
  stepId: string;
};

export type HumanHandoffRecord = {
  code: string;
  requestedAt: string;
  resolvedAt: string;
  checks: number;
};

export type ReplayMetadata = {
  runId: string;
  capabilityId: string;
  capabilityVersion: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  completedSteps: string[];
  recoveries: RecoveryRecord[];
  humanHandoffs: HumanHandoffRecord[];
};

export type ReplaySuccess = ReplayMetadata & {
  status: "success";
  output: Record<string, CapabilityValue>;
};

export type ReplayBusinessOutcome = ReplayMetadata & {
  status: "business_outcome";
  code: string;
  message: string;
  stepId: string;
};

export type ReplayHumanRequired = ReplayMetadata & {
  status: "human_required";
  code: string;
  message: string;
  stepId: string;
  evidenceArtifact?: string;
};

export type ReplayFailure = ReplayMetadata & {
  status: "failure";
  failureKind:
    | "invalid_artifact"
    | "invalid_input"
    | "policy_denied"
    | "ui_mismatch"
    | "surface_error"
    | "permission_denied"
    | "application_error"
    | "recoverable_exhausted";
  message: string;
  stepId: string;
  code?: string;
  evidenceArtifact?: string;
};

export type ReplayResult =
  | ReplaySuccess
  | ReplayBusinessOutcome
  | ReplayHumanRequired
  | ReplayFailure;
