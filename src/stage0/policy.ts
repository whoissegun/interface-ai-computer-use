import { readFileSync } from "node:fs";
import type { BrowserTool, JsonObject, Scenario } from "./types.js";

export type ToolDecision = {
  description: string;
  decision: "offer" | "withhold";
  reason: string;
};

type ToolPolicyFile = {
  schemaVersion: number;
  playwrightMcpVersion: string;
  capabilities: string[];
  tools: Record<string, ToolDecision>;
};

const policyUrl = new URL("../../config/stage0-playwright-tool-policy.json", import.meta.url);
export const toolPolicy = JSON.parse(readFileSync(policyUrl, "utf8")) as ToolPolicyFile;

export const offeredToolNames = new Set(
  Object.entries(toolPolicy.tools)
    .filter(([, policy]) => policy.decision === "offer")
    .map(([name]) => name)
);

export function classifyTools(tools: BrowserTool[]): {
  offered: BrowserTool[];
  withheld: Array<BrowserTool & { reason: string }>;
} {
  const unclassified = tools.filter((tool) => !toolPolicy.tools[tool.name]);
  if (unclassified.length > 0) {
    throw new Error(
      `Playwright MCP returned tools without an explicit policy decision: ${unclassified.map((tool) => tool.name).join(", ")}`
    );
  }

  return {
    offered: tools.filter((tool) => toolPolicy.tools[tool.name]?.decision === "offer"),
    withheld: tools
      .filter((tool) => toolPolicy.tools[tool.name]?.decision === "withhold")
      .map((tool) => ({ ...tool, reason: toolPolicy.tools[tool.name]?.reason ?? "No reason recorded." }))
  };
}

export function policyDenial(
  scenario: Scenario,
  targetUrl: URL,
  toolName: string,
  args: JsonObject
): string | null {
  if (!offeredToolNames.has(toolName)) {
    return `Tool ${toolName} is outside the Stage 0 browser-action allowlist.`;
  }

  if (toolName === "browser_navigate") {
    if (typeof args.url !== "string") return "browser_navigate requires a URL string.";
    let requested: URL;
    try {
      requested = new URL(args.url, targetUrl);
    } catch {
      return "browser_navigate received an invalid URL.";
    }
    if (requested.origin !== targetUrl.origin) {
      return `Navigation is restricted to ${targetUrl.origin}.`;
    }
  }

  if (toolName === "browser_tabs" && args.action === "new" && typeof args.url === "string") {
    let requested: URL;
    try {
      requested = new URL(args.url, targetUrl);
    } catch {
      return "browser_tabs received an invalid new-tab URL.";
    }
    if (requested.origin !== targetUrl.origin) {
      return `New-tab navigation is restricted to ${targetUrl.origin}.`;
    }
  }

  if (!scenario.allowFinalSubmission) {
    if (
      toolName === "browser_click" &&
      typeof args.element === "string" &&
      /simulate final submission/i.test(args.element)
    ) {
      return "This scenario does not authorize final submission. Stop at the review boundary.";
    }

    if (toolName === "browser_handle_dialog" && args.accept === true) {
      return "This scenario does not authorize accepting a final-submission dialog.";
    }
  }

  return null;
}
