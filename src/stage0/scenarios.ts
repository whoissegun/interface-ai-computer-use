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
