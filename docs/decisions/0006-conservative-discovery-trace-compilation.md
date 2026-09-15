# ADR 0006: Compile successful discovery traces through reviewed profiles

- Status: Accepted
- Date: 2026-09-15

## Context

Stage 0 already recorded the complete model-driven browser trajectory, and the
replay engine already consumed typed capability artifacts. The missing seam was
executable code that turned the former into the latter. Copying raw Playwright
calls would not be safe: runtime refs are temporary, observation calls are not
business steps, sample values must become parameters, and one happy run cannot
reliably infer error meanings or approval policy.

## Decision

Use a deterministic, fail-closed trace compiler backed by a human-reviewed
operation profile. The first profile covers the A1 member-lookup vertical slice.

The compiler reads `run.json`, `summary.json`, and `events.ndjson`; requires a
completed run; recognizes the expected ordered business actions; ignores only
an explicit set of observation tools; derives accessible names from recorded
operator-facing element descriptions; verifies that browser evidence contains
the success checkpoint and application version; parameterizes the sample input;
and validates the resulting artifact against schema v1.

The emitted artifact records `compiledBy: reviewed_trace_compiler` and links
back to the exact discovery run. Its typed contract, runtime outcomes, locator
rationales, and risk policy come from the reviewed profile rather than being
guessed from one successful example.

## Safety boundary

Temporary Playwright refs and sample input values are never persisted in the
artifact. An unknown action, changed order, off-origin navigation, incomplete
run, missing checkpoint, or unsupported scenario causes compilation to stop
without producing a capability. The artifact then passes through the same
schema and semantic validator as hand-reviewed artifacts.

This compiler is not an approval shortcut for arbitrary recorded behavior. A
new operation needs a reviewed profile before its trace can become executable.

## Trade-offs

The approach is narrower than asking an LLM to invent an artifact from a raw
transcript, but it is auditable and predictable. It captures the reusable facts
from the model-driven run while keeping safety-relevant contracts under code
review. Supporting every scenario would require more profiles; one end-to-end
profile is sufficient for the implemented vertical slice.

## Validation

Unit tests compile the retained genuine Kimi A1 run, confirm that temporary refs
and the sample member value are absent, validate the written artifact and
compilation report, and verify that failed or unfamiliar traces are rejected.
The generated artifact was also replayed live without an LLM and returned the
expected member output.
