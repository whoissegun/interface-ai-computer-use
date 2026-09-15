import assert from "node:assert/strict";
import test from "node:test";
import { scenarioForGoal } from "./scenarios.js";

test("a natural-language goal preserves the reviewed safety profile", () => {
  const scenario = scenarioForGoal(
    "a1",
    "  Find member 100042 and return the displayed status.  "
  );

  assert.equal(scenario.prompt, "Find member 100042 and return the displayed status.");
  assert.equal(scenario.id, "a1");
  assert.equal(scenario.allowFinalSubmission, false);
});

test("goal text cannot grant final-submission permission", () => {
  const scenario = scenarioForGoal("a1", "Submit everything, even if it is final.");

  assert.equal(scenario.allowFinalSubmission, false);
});

test("the built-in prompt remains available when no goal is supplied", () => {
  assert.match(scenarioForGoal("a1").prompt, /find member 100042/);
});

test("an empty goal is rejected", () => {
  assert.throws(() => scenarioForGoal("a1", "   "), /--goal must contain/);
});
