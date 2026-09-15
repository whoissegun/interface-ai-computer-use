# ADR 0005: Route natural language through a bounded capability loop

- Status: Accepted
- Date: 2026-09-14

## Context

Deterministic replay exposes four typed business operations, but callers still
need to translate ordinary requests into a capability name and input object.
Real requests may be precise, informal, misspelled, incomplete, conflicting,
or ask for multiple operations.

Giving the routing model low-level browser tools would recreate the discovery
agent in production and bypass the reviewed capability artifacts. Using only a
single classification response would handle one operation but would not
compose the balance-plus-preparation task or let the model ground its final
answer in returned values.

## Decision

Expose each approved capability as an OpenAI-compatible function tool. Generate
its parameter schema from the capability artifact, pass those tools through
OpenRouter's structured `tools` field, and dispatch returned calls through a
fixed name-to-artifact registry.

The model receives only `find_member`, `read_balance`,
`prepare_subaccount`, and, when externally approved,
`simulate_subaccount`. It never receives Playwright MCP operations.

The loop returns each compact typed replay result to the model. It permits
multiple capabilities for an explicitly chained request and then lets the
model write a grounded final response.

## Bounds

The hard ceiling is three capability calls. The longest current supported task
needs two calls: balance inquiry followed by preparation. One additional call
is enough margin for correction while remaining easy to audit.

Identical tool name and argument objects are rejected as duplicates. Invalid
JSON, unknown tool names, and requests over the ceiling are structured
rejections. After any non-success replay result, later calls already bundled in
that response are rejected and the following model turn is given no tools, so
it cannot continue mutating state.

Browser steps and T14 recovery occur inside one deterministic capability and
do not consume routing-call budget.

## Ambiguity policy

Missing required fields and genuinely conflicting values cause a clarification
question with zero capability calls. Informal language, abbreviations, and
typos are accepted when all required values remain unambiguous. The model must
use supplied identifiers verbatim and must not guess.

This policy is model-guided rather than fully deterministic. Therefore its
behavior is covered by a checked-in evaluation set, while all actions after a
capability has been selected remain deterministic and schema-validated.

## Risk and HITL boundaries

Natural-language text cannot authorize the final simulation. The risky tool is
omitted unless the host provides an external approval signal. The replay
executor independently requires that signal as defense in depth.

HITL remains below the model boundary. The deterministic executor detects H91,
notifies the human, waits in the same session, and resumes or stops. The router
only receives the finished capability result.

## Model choice

Kimi K2.6 is the default for this stage because the work is narrow structured
tool selection and argument extraction, not UI discovery. The model is
configurable, and the routing evaluation—not the model name—is the acceptance
criterion.

## Validation

Unit tests cover the safe capability catalog, generated required parameters,
one-call routing, chained calls, zero-action clarification, duplicate blocking,
the call ceiling, and removal of tools after a non-success result.

The final live evaluation used nine requests spanning clear, messy, chained,
ambiguous, conflicting, risky, and H91 cases. Kimi K2.6 selected the expected
capability sequence and produced the expected grounded response in 9/9 cases.
The first evaluation pass was behaviorally correct in 8/8 cases, but one valid
safe refusal did not match the evaluator's overly narrow wording pattern. Only
the evaluator was broadened before the final pass.

## Consequences

The model remains useful for language understanding and composition without
becoming part of browser execution. Chained tasks are supported, ambiguity can
be surfaced before side effects, and the model cannot grant itself risky
authority. The remaining nondeterministic surface is intentionally small: tool
choice, argument extraction, and final wording.
