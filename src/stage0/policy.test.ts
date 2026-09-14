import assert from "node:assert/strict";
import test from "node:test";
import { policyDenial } from "./policy.js";
import { getScenario } from "./scenarios.js";

const target = new URL("https://target-app-gamma.vercel.app/");

test("navigation is limited to the configured target origin", () => {
  assert.equal(policyDenial(getScenario("a1"), target, "browser_navigate", { url: "/app/home" }), null);
  assert.match(
    policyDenial(getScenario("a1"), target, "browser_navigate", { url: "https://example.com" }) ?? "",
    /restricted/
  );
});

test("final submission actions require scenario authorization", () => {
  assert.match(
    policyDenial(getScenario("a3"), target, "browser_click", {
      element: "SIMULATE FINAL SUBMISSION",
      ref: "e17"
    }) ?? "",
    /does not authorize/
  );
  assert.equal(
    policyDenial(getScenario("a4"), target, "browser_click", {
      element: "SIMULATE FINAL SUBMISSION",
      ref: "e17"
    }),
    null
  );
});

test("unneeded high-power tools are denied", () => {
  assert.match(
    policyDenial(getScenario("a1"), target, "browser_evaluate", { expression: "document.cookie" }) ?? "",
    /outside/
  );
});
