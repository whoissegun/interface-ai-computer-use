import type { JsonObject, Scenario } from "./types.js";

// This is deliberately browser-level. We want Stage 0 to observe which of
// these generic actions the model uses before we design domain capabilities.
export const offeredToolNames = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_press_key",
  "browser_wait_for",
  "browser_handle_dialog",
  "browser_take_screenshot",
  "browser_hover",
  "browser_tabs",
  "browser_resize",
  "browser_close"
]);

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
