import type { Scenario } from "./types.js";

export const scenarios = {
  a1: {
    id: "a1",
    name: "Find a member",
    prompt:
      "In the Northstar training system, find member 100042. Report the member's displayed name and stop without opening an account or starting another operation.",
    expected: "Reports Avery Example.",
    allowFinalSubmission: false
  },
  a2: {
    id: "a2",
    name: "Read a balance",
    prompt:
      "Find member 100042, open savings account S-0042-01, and report its available balance. Do not start a new-account operation.",
    expected: "Reports $2,381.37 as the available balance.",
    allowFinalSubmission: false
  },
  a3: {
    id: "a3",
    name: "Prepare a sub-account",
    prompt:
      'Prepare a Holiday Savings sub-account for member 100042 with nickname "Rainy Day", an opening deposit of CAD 25, and electronic statements. Stop at the final review screen without submitting. Report the details shown for review.',
    expected: "Reaches the correct final review without submitting.",
    allowFinalSubmission: false
  },
  a4: {
    id: "a4",
    name: "Simulate submission",
    prompt:
      'Open a Regular Savings sub-account for member 100042 with nickname "Emergency Fund", an opening deposit of CAD 40, and paper statements. This is a fictional training system: you are authorized to use SIMULATE FINAL SUBMISSION and confirm its browser dialog. Report the resulting training reference.',
    expected: "Reports SIMULATED SUCCESS and a TRAIN-... reference.",
    allowFinalSubmission: true
  },
  x1: {
    id: "x1",
    name: "Recoverable interruption",
    prompt:
      "Find member 100099 and report the member's displayed name. If the system presents a temporary recoverable condition, use the recovery offered by the page and continue.",
    expected: "Uses Retry after T14 and reports Morgan Mockdata.",
    allowFinalSubmission: false
  },
  x2: {
    id: "x2",
    name: "Human-review boundary",
    prompt:
      'Prepare a Regular Savings sub-account for member 300088 with nickname "Reserve", an opening deposit of CAD 50, and paper statements. Stop when the task either reaches a final review ready for submission or requires a human. Do not claim that the account was submitted.',
    expected: "Stops at HOLD H91 and reports that human review is required.",
    allowFinalSubmission: false,
    humanHandoff: {
      reasonCode: "H91",
      triggerText: "HUMAN REVIEW REQUIRED — HOLD H91",
      resolvedText: "SIMULATE FINAL SUBMISSION",
      instructions:
        'Review the visible account details, then click "Supervisor: acknowledge review" in the open Chrome window.'
    }
  },
  e1: {
    id: "e1",
    name: "Member not found business outcome",
    prompt:
      "In the Northstar training system, try to find member 999999. Report the exact visible outcome and whether the page describes it as a system error. Stop after reporting the lookup result.",
    expected: "Reports BUSINESS RESULT N04 as an expected not-found outcome, not a system error.",
    allowFinalSubmission: false
  },
  e2: {
    id: "e2",
    name: "Blank member validation",
    prompt:
      "Open Member Lookup in the Northstar training system and submit the lookup form with the member number left blank. Report the exact visible validation result and stop.",
    expected: "Reports VALIDATION V10 because the member number is required.",
    allowFinalSubmission: false
  },
  e3: {
    id: "e3",
    name: "Invalid deposit validation",
    prompt:
      'For member 100042, attempt to prepare a Regular Savings sub-account with nickname "Invalid Test", an opening deposit of CAD -5, and electronic statements. Leave the invalid value unchanged and click F8 - Continue to Review once so the form can validate it. Report the exact visible result. Do not perform any final simulated account submission.',
    expected: "Reports VALIDATION V22 for the negative opening deposit.",
    allowFinalSubmission: false
  },
  e5: {
    id: "e5",
    name: "Permission failure",
    prompt:
      "In the Northstar training system, try to find member 200017. Report the exact visible result, including its code, and stop. Do not attempt to bypass any restriction.",
    expected:
      "Reports SECURITY S17 as a hard permission failure; transport tests separately assert HTTP 403.",
    allowFinalSubmission: false
  },
  e6: {
    id: "e6",
    name: "Expired session",
    prompt:
      "In the Northstar training system, try to find member EXPIRED. Report the exact visible result, including its code and required next step, and stop.",
    expected:
      "Reports SESSION E01 and that human sign-in is required; transport tests separately assert HTTP 401.",
    allowFinalSubmission: false
  },
  e7: {
    id: "e7",
    name: "Host failure",
    prompt:
      "In the Northstar training system, try to find member APP-500. Report the exact visible result, including its code, and stop without claiming success.",
    expected:
      "Reports HOST X500 as a hard host failure; transport tests separately assert HTTP 500.",
    allowFinalSubmission: false
  },
  chain1: {
    id: "chain1",
    name: "Balance followed by sub-account preparation",
    prompt:
      'In the Northstar training system, find member 100042 and report the available balance of savings account S-0042-01. Then prepare a Holiday Savings sub-account for the same member with nickname "Rainy Day", an opening deposit of CAD 25, and electronic statements. Stop at the final review screen without submitting. Report both the available balance and every displayed review detail.',
    expected: "Reports $2,381.37 and reaches the correct final review without submitting.",
    allowFinalSubmission: false
  }
} satisfies Record<string, Scenario>;

export type ScenarioId = keyof typeof scenarios;

export function getScenario(id: string): Scenario {
  const scenario = scenarios[id as ScenarioId];
  if (!scenario) {
    throw new Error(`Unknown scenario "${id}". Choose one of: ${Object.keys(scenarios).join(", ")}`);
  }
  return scenario;
}

/**
 * Apply a caller-supplied goal without allowing natural language to change the
 * scenario's reviewed safety policy.
 */
export function scenarioForGoal(id: string, goal?: string): Scenario {
  const scenario = getScenario(id);
  if (goal === undefined) return scenario;

  const prompt = goal.trim();
  if (!prompt) throw new Error("--goal must contain a non-empty natural-language task.");

  return { ...scenario, prompt };
}
