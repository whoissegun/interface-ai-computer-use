import { resolve } from "node:path";
import type { ModelTool } from "../model/types.js";
import { loadCapabilityArtifact } from "../replay/artifact.js";
import type { CapabilityArtifact, InputSpec } from "../replay/types.js";
import type { CapabilityRegistration } from "./types.js";

const catalog = [
  {
    toolName: "find_member",
    artifactPath: "capabilities/northstar.find-member.v1.json",
    guidance:
      "Use when the task only asks for the member identity or status. Do not use it as a prerequisite for another capability because those capabilities perform their own member lookup."
  },
  {
    toolName: "read_balance",
    artifactPath: "capabilities/northstar.read-balance.v1.json",
    guidance:
      "Use when both a member number and a specific account number are supplied and the task asks for account balances. This capability includes member lookup."
  },
  {
    toolName: "prepare_subaccount",
    artifactPath: "capabilities/northstar.prepare-subaccount.v1.json",
    guidance:
      "Use to prepare a savings sub-account and stop at the verified review screen. It requires member number, product, nickname, opening deposit, and statement delivery."
  },
  {
    toolName: "simulate_subaccount",
    artifactPath: "capabilities/northstar.simulate-subaccount.v1.json",
    guidance:
      "Use only when the task explicitly asks to complete the fictional final-submission simulation. This tool is exposed only after external risky-action approval."
  }
] as const;

function inputProperty(spec: InputSpec): Record<string, unknown> {
  if (spec.type === "string") {
    return {
      type: "string",
      description: spec.description,
      ...(spec.minLength === undefined ? {} : { minLength: spec.minLength }),
      ...(spec.maxLength === undefined ? {} : { maxLength: spec.maxLength }),
      ...(spec.pattern ? { pattern: spec.pattern } : {}),
      ...(spec.enum ? { enum: spec.enum } : {})
    };
  }
  return {
    type: "number",
    description: spec.description,
    ...(spec.minimum === undefined ? {} : { minimum: spec.minimum }),
    ...(spec.maximum === undefined ? {} : { maximum: spec.maximum })
  };
}

function toModelTool(
  toolName: string,
  artifact: CapabilityArtifact,
  guidance: string
): ModelTool {
  return {
    type: "function",
    function: {
      name: toolName,
      description: `${artifact.description} ${guidance}`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(artifact.inputs).map(([name, spec]) => [name, inputProperty(spec)])
        ),
        required: Object.keys(artifact.inputs)
      }
    }
  };
}

export async function loadCapabilityCatalog(options: {
  includeRisky: boolean;
}): Promise<CapabilityRegistration[]> {
  const registrations: CapabilityRegistration[] = [];
  for (const entry of catalog) {
    const artifactPath = resolve(entry.artifactPath);
    const artifact = await loadCapabilityArtifact(artifactPath);
    if (artifact.risk.requiresConfirmation && !options.includeRisky) continue;
    registrations.push({
      toolName: entry.toolName,
      artifactPath,
      artifact,
      modelTool: toModelTool(entry.toolName, artifact, entry.guidance)
    });
  }
  return registrations;
}

export function redactedInputs(
  registration: CapabilityRegistration,
  values: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const policy = registration.artifact.inputs[name]?.logPolicy ?? "redact";
      if (policy === "plain") return [name, value];
      if (policy === "last4") return [name, `***${String(value).slice(-4)}`];
      return [name, "[REDACTED]"];
    })
  );
}
