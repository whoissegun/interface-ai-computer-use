import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CapabilityArtifact, CapabilityValue, InputSpec, ReplayStep } from "./types.js";

type SchemaError = { instancePath: string; message?: string };
type SchemaValidator = ((value: unknown) => boolean) & { errors?: SchemaError[] | null };
type AjvInstance = { compile(schema: object): SchemaValidator };

const schemaUrl = new URL("../../capabilities/schema.v1.json", import.meta.url);
const Ajv2020Constructor = Ajv2020 as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => AjvInstance;
const applyFormats = addFormats as unknown as (instance: AjvInstance) => void;
const ajv = new Ajv2020Constructor({ allErrors: true, strict: true });
applyFormats(ajv);
const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaUrl, "utf8")) as object);

export class ArtifactValidationError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ArtifactValidationError(`${field} must be a non-empty string.`);
  }
}

function validateLocator(
  step: Record<string, unknown>,
  field: string,
  inputs: Record<string, InputSpec>
): void {
  if (!isObject(step.locator)) throw new ArtifactValidationError(`${field}.locator must be an object.`);
  if (step.locator.kind !== "accessibility") {
    throw new ArtifactValidationError(`${field}.locator.kind must be accessibility.`);
  }
  if (!(["link", "button", "textbox", "combobox", "radio"] as unknown[]).includes(step.locator.role)) {
    throw new ArtifactValidationError(`${field}.locator.role is unsupported.`);
  }
  const hasName = typeof step.locator.name === "string" && step.locator.name.length > 0;
  const hasNearText = typeof step.locator.nearText === "string" && step.locator.nearText.length > 0;
  if (hasName === hasNearText) {
    throw new ArtifactValidationError(`${field}.locator needs exactly one of name or nearText.`);
  }
  if (
    typeof step.locator.withinRowInput === "string" &&
    !inputs[step.locator.withinRowInput]
  ) {
    throw new ArtifactValidationError(
      `${field}.locator references unknown row input ${step.locator.withinRowInput}.`
    );
  }
  requireString(step.locator.rationale, `${field}.locator.rationale`);
}

function validateStep(value: unknown, index: number, inputs: Record<string, InputSpec>): void {
  if (!isObject(value)) throw new ArtifactValidationError(`steps[${index}] must be an object.`);
  requireString(value.id, `steps[${index}].id`);
  if (value.action === "navigate") {
    requireString(value.path, `steps[${index}].path`);
    if (!isObject(value.expect) || value.expect.kind !== "visible_text") {
      throw new ArtifactValidationError(`steps[${index}].expect must be a visible_text checkpoint.`);
    }
    requireString(value.expect.text, `steps[${index}].expect.text`);
    return;
  }
  if (value.action === "click") {
    validateLocator(value, `steps[${index}]`, inputs);
    return;
  }
  if (value.action === "type") {
    validateLocator(value, `steps[${index}]`, inputs);
    requireString(value.input, `steps[${index}].input`);
    if (!inputs[value.input]) {
      throw new ArtifactValidationError(`steps[${index}] references unknown input ${value.input}.`);
    }
    return;
  }
  if (value.action === "select_option") {
    validateLocator(value, `steps[${index}]`, inputs);
    requireString(value.input, `steps[${index}].input`);
    if (!inputs[value.input]) {
      throw new ArtifactValidationError(`steps[${index}] references unknown input ${value.input}.`);
    }
    return;
  }
  if (value.action === "click_choice") {
    requireString(value.input, `steps[${index}].input`);
    if (!inputs[value.input]) {
      throw new ArtifactValidationError(`steps[${index}] references unknown input ${value.input}.`);
    }
    if (!isObject(value.choices)) {
      throw new ArtifactValidationError(`steps[${index}].choices must be an object.`);
    }
    for (const [choice, locator] of Object.entries(value.choices)) {
      validateLocator({ locator }, `steps[${index}].choices.${choice}`, inputs);
    }
    return;
  }
  if (value.action === "verify") {
    if (!Array.isArray(value.fields)) {
      throw new ArtifactValidationError(`steps[${index}].fields must be an array.`);
    }
    for (const field of value.fields) {
      if (!isObject(field) || typeof field.input !== "string" || !inputs[field.input]) {
        throw new ArtifactValidationError(`steps[${index}] has a field with an unknown input.`);
      }
    }
    return;
  }
  if (value.action === "handle_dialog") return;
  throw new ArtifactValidationError(`steps[${index}].action is unsupported.`);
}

export function validateCapabilityArtifact(value: unknown): CapabilityArtifact {
  if (!isObject(value)) throw new ArtifactValidationError("Artifact must be a JSON object.");
  if (!validateSchema(value)) {
    const details = (validateSchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new ArtifactValidationError(`Artifact does not match schema v1: ${details}`);
  }
  if (value.schemaVersion !== 1) throw new ArtifactValidationError("Only schemaVersion 1 is supported.");
  if (value.kind !== "computer_use_capability") {
    throw new ArtifactValidationError("Artifact kind must be computer_use_capability.");
  }
  requireString(value.id, "id");
  requireString(value.version, "version");
  requireString(value.name, "name");
  if (!isObject(value.surface) || !Array.isArray(value.surface.allowedOrigins)) {
    throw new ArtifactValidationError("surface.allowedOrigins must be an array.");
  }
  for (const origin of value.surface.allowedOrigins) {
    requireString(origin, "surface.allowedOrigins[]");
    const parsed = new URL(origin);
    if (parsed.origin !== origin) {
      throw new ArtifactValidationError(`Allowed origin must not include a path: ${origin}`);
    }
  }
  if (!isObject(value.inputs)) throw new ArtifactValidationError("inputs must be an object.");
  const inputs = value.inputs as Record<string, InputSpec>;
  if (!isObject(value.outputs)) throw new ArtifactValidationError("outputs must be an object.");
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new ArtifactValidationError("steps must be a non-empty array.");
  }
  value.steps.forEach((step, index) => validateStep(step, index, inputs));
  const ids = value.steps.map((step) => (step as ReplayStep).id);
  if (new Set(ids).size !== ids.length) throw new ArtifactValidationError("Step ids must be unique.");
  if (!isObject(value.completion) || !isObject(value.completion.checkpoint)) {
    throw new ArtifactValidationError("completion.checkpoint is required.");
  }
  if (!Array.isArray(value.completion.outcomes) || !Array.isArray(value.completion.assertions)) {
    throw new ArtifactValidationError("completion outcomes and assertions must be arrays.");
  }
  if (!isObject(value.risk) || !Array.isArray(value.risk.allowedActions)) {
    throw new ArtifactValidationError("A risk policy with allowedActions is required.");
  }
  const artifact = value as CapabilityArtifact;
  if (artifact.risk.level === "simulated_irreversible" && !artifact.risk.requiresConfirmation) {
    throw new ArtifactValidationError("Simulated irreversible capabilities must require confirmation.");
  }
  for (const [index, step] of artifact.steps.entries()) {
    if (!artifact.risk.allowedActions.includes(step.action)) {
      throw new ArtifactValidationError(`steps[${index}].action is not allowed by the risk policy.`);
    }
    if (step.action === "select_option" || step.action === "click_choice") {
      const spec = artifact.inputs[step.input];
      const choices = Object.keys(step.action === "select_option" ? step.options : step.choices);
      if (!spec || spec.type !== "string" || !spec.enum) {
        throw new ArtifactValidationError(
          `steps[${index}] needs a string enum input so every UI choice is reviewable.`
        );
      }
      if (
        choices.length !== spec.enum.length ||
        choices.some((choice) => !spec.enum?.includes(choice))
      ) {
        throw new ArtifactValidationError(`steps[${index}] must map every declared input choice.`);
      }
    }
    if (step.action === "handle_dialog") {
      const previous = artifact.steps[index - 1];
      if (
        artifact.risk.level !== "simulated_irreversible" ||
        !artifact.risk.requiresConfirmation ||
        previous?.action !== "click" ||
        !previous.expectDialogText
      ) {
        throw new ArtifactValidationError(
          `steps[${index}] may accept a dialog only after a confirmed, expected dialog.`
        );
      }
    }
  }
  for (const [index, assertion] of artifact.completion.assertions.entries()) {
    if (!artifact.outputs[assertion.output] || !artifact.inputs[assertion.input]) {
      throw new ArtifactValidationError(
        `completion.assertions[${index}] must reference declared input and output fields.`
      );
    }
  }
  for (const outcome of artifact.completion.outcomes) {
    if (
      outcome.classification === "human_required" &&
      outcome.handoff?.authorizedAction &&
      !artifact.risk.allowedActions.includes("click")
    ) {
      throw new ArtifactValidationError(
        `Handoff ${outcome.code} declares an authorized click outside the risk policy.`
      );
    }
  }
  return artifact;
}

export async function loadCapabilityArtifact(path: string): Promise<CapabilityArtifact> {
  const raw = await readFile(path, "utf8");
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

export function validateCapabilityInputs(
  artifact: CapabilityArtifact,
  values: Record<string, unknown>
): Record<string, CapabilityValue> {
  const unknown = Object.keys(values).filter((name) => !artifact.inputs[name]);
  if (unknown.length > 0) throw new ArtifactValidationError(`Unknown input(s): ${unknown.join(", ")}.`);

  const validated: Record<string, CapabilityValue> = {};
  for (const [name, spec] of Object.entries(artifact.inputs)) {
    const value = values[name];
    if (spec.type === "string") {
      if (typeof value !== "string") throw new ArtifactValidationError(`${name} must be a string.`);
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        throw new ArtifactValidationError(`${name} must contain at least ${spec.minLength} character(s).`);
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        throw new ArtifactValidationError(`${name} must contain at most ${spec.maxLength} character(s).`);
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
        throw new ArtifactValidationError(`${name} does not match the capability contract.`);
      }
      if (spec.enum && !spec.enum.includes(value)) {
        throw new ArtifactValidationError(`${name} must be one of: ${spec.enum.join(", ")}.`);
      }
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ArtifactValidationError(`${name} must be a finite number.`);
      }
      if (spec.minimum !== undefined && value < spec.minimum) {
        throw new ArtifactValidationError(`${name} must be at least ${spec.minimum}.`);
      }
      if (spec.maximum !== undefined && value > spec.maximum) {
        throw new ArtifactValidationError(`${name} must be at most ${spec.maximum}.`);
      }
    }
    validated[name] = value;
  }
  return validated;
}
