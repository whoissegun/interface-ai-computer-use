# ADR 0004: Compose the deterministic capability set and gate risky actions

- Status: Accepted
- Date: 2026-09-14

## Context

The first replay slice proved member lookup. The target also exposes balance
inquiry, sub-account preparation, and a fictional final-submission simulation.
Those flows reuse navigation and member lookup but have different inputs,
outputs, completion checkpoints, and risk. Treating the whole application as
one large script would give a calling agent no precise typed contract and
would make the final action too easy to reach accidentally.

## Decision

Keep four small, independently versioned capabilities and execute all of them
with one fixed interpreter. An upstream agent maps natural language to a
capability ID and typed inputs; it does not invent browser actions during
replay.

The artifact action language now contains only the operations observed during
discovery: navigate, semantic click, type, select option, choose a radio,
verify fields, and handle an expected dialog. Output extraction is limited to
labeled accessibility table rows. Each UI action resolves a fresh runtime ref
from a semantic locator and discards that ref immediately.

Account inquiry uses a compound locator: find the row containing the exact
requested account number, then require exactly one `INQUIRE` link inside that
row. This prevents a generic link match from opening the wrong account.

Preparation stops only when `REVIEW CHECKPOINT` is visible and every extracted
field equals its typed input. The final-simulation capability repeats those
checks immediately before the final button. It also requires explicit caller
confirmation before the browser connects, requires the exact expected native
dialog text, and accepts that dialog only through the following declared step.

## Human review

H91 is a typed human-required outcome with instructions and a resume
checkpoint. In ordinary replay the result returns immediately as
`human_required`. In wait mode the headed browser remains open and the executor
polls that same session. A human can operate the declared supervisor control
directly. A host application may instead provide a decision callback; the
executor applies the artifact's supervisor action only after that callback
returns explicit approval. Rejection and timeout leave the outcome as
`human_required`.

E01 remains a terminal human-required result because the demo app intentionally
does not provide a sign-in surface to complete in-session.

## Schema and validation

JSON Schema validates serialization shape. Runtime cross-field checks reject:

- an action omitted from the artifact's risk allowlist;
- a product or radio map that does not cover its complete input enum;
- an assertion referring to an undeclared input or output;
- a simulated irreversible capability without confirmation;
- dialog acceptance without a preceding click declaring expected dialog text;
- a human controller click outside the artifact action policy.

Invalid artifacts and invalid input fail before browser connection.

## Repeatability criterion

Determinism means the capability version, structured status/output, completed
step IDs, recoveries, and human handoffs are stable for the same input and
target version. Run IDs, timestamps, elapsed time, and temporary accessibility
refs are deliberately excluded.

`npm run replay:stability` performs three fresh live runs of all four
capabilities and fails if any stable result differs. The 2026-09-14 experiment
produced 12/12 successes with identical stable results within each capability.

## Validation and evidence

The unit suite covers all four artifact schemas, row-scoped account selection,
currency extraction, V22, final-action confirmation before connection, review
mismatch fail-closed behavior, expected-dialog handling, and same-session H91
resume. The existing suite also covers N04, bounded T14 recovery, S17, E01,
X500, origin policy, tool policy, and evidence redaction.

Live evidence includes:

- three consistent success runs for each of the four capabilities;
- a missing-account business outcome;
- V22 validation;
- final-simulation policy denial without approval;
- a successful approved fictional simulation;
- H91 returned as `human_required` after a live wait timed out;
- H91 resumed successfully in the same session through the controlled-approval path.

## Consequences

The capability boundary is explicit and reviewable, and the risky path cannot
be reached by choosing a vague prompt. The trade-off is that new UI controls,
copy, or workflows require a reviewed artifact version rather than an implicit
model fallback. This is intentional: unknown UI fails as `ui_mismatch` and is
sent back to discovery instead of silently broadening production behavior.
