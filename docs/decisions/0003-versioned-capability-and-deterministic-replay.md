# ADR 0003: Compile discovery into a versioned capability artifact

- Status: Accepted for the first deterministic vertical slice
- Date: 2026-09-14

## Context

Stage 0 produced three successful model-driven member-lookup trajectories. The
temporary element refs in those trajectories, such as `f2e3`, belong only to
the browser session that generated them. Replaying those raw calls would be
brittle and would leave the model transcript as an accidental production
contract.

The production path instead needs a small, typed artifact that another agent
can understand and invoke, plus an executor that always follows the artifact
without asking an LLM what to do next.

## Decision

We will represent a reusable flow as a JSON capability artifact with:

- an explicit schema and artifact version;
- provenance linking it to successful discovery runs;
- a surface kind and supported application version;
- allowlisted target origins and action types;
- typed inputs with validation and log-redaction policies;
- typed outputs with declarative extraction rules;
- ordered action steps;
- a rationale beside every locator;
- a final checkpoint and input/output assertions;
- declared business, recoverable, human-required, and hard-failure outcomes.

The first artifact is `northstar.find-member@1.0.0`. It is marked
`human_reviewed` because Stage 0 does not yet automatically compile a model
trajectory into an approved artifact. The three source run IDs are part of the
artifact, while their raw prompts and reasoning are not.

Both a JSON Schema and TypeScript definitions describe version 1. The replay
loader executes the JSON Schema validation before opening a browser, then
checks relationships the schema cannot express conveniently, such as step IDs
being unique and a type step referring to a declared input.

## Locator strategy

Artifacts store semantic accessibility descriptions, not runtime refs or
coordinates. Before every action, the accessibility adapter searches the
current tree and requires exactly one matching control. The returned ref is
used immediately and then discarded.

The target has one intentionally hostile case: its member-number input has no
programmatic label. That locator uses the stable visible text `Member Number`
and the adjacent textbox relationship. This is more faithful to how an
operator identifies the field than the cryptic HTML name `mbr_no_x7` and is
portable to a non-DOM accessibility surface.

An ambiguous or missing match is a `ui_mismatch`; the executor does not guess,
fall back to coordinates, or invoke a model.

## Deterministic execution and checkpoints

The executor performs a fixed sequence: navigate, resolve and click Member
Lookup, resolve and type the input, resolve and click Locate, then evaluate the
declared terminal state. Important navigation steps assert visible text before
the next action. Success requires all of the following:

1. `Member Relationship Summary` is visible.
2. Every declared output can be extracted from its labeled table row.
3. The returned member number equals the requested member number.

This prevents a click from being mistaken for success and prevents a stale or
wrong member page from returning plausible-looking data.

## Runtime outcomes

The result is a discriminated union rather than a boolean:

- `success` contains typed outputs;
- `business_outcome` reports N04 without treating it as a crash;
- T14 performs its declared retry at most once and records the recovery;
- `human_required` reports E01 because a person must sign in;
- `failure` distinguishes permission denial, application error, exhausted
  recovery, surface errors, policy denial, invalid input, and UI mismatch.

Known outcomes are recognized only by their declared visible markers. An
unknown page fails closed as `ui_mismatch` and captures richer evidence.

## Safety and evidence

Replay verifies the target origin against the artifact before connecting. It
also checks that every required surface operation is allowed by the artifact
and actually exists. This capability is declared read-only and contains no
submission action.

The caller receives real output values, but persisted input and output fields
follow their log policies: member numbers keep only the final four characters
and displayed names are redacted. Ordered evidence contains step IDs,
locators, checkpoints, classifications, and recovery decisions without model
reasoning. Hard failures and human-required results include a screenshot. The
checked-in target contains fictional data; a production adapter would also
need screenshot and raw-surface redaction before persistence.

## Surface abstraction

Discovery and replay now share a minimal `SurfaceClient` seam: connect, list
operations, perform an operation, and close. Playwright MCP is the web
accessibility implementation. A desktop adapter can provide the same logical
operations while resolving the artifact locator through an OS accessibility
tree. The artifact does not import Playwright-specific TypeScript types.

## Alternatives considered

### Replay the raw model tool calls

Rejected because runtime refs expire, repeated exploratory snapshots are not
meaningful production steps, and model reasoning is not a stable or reviewable
contract.

### Generate a Playwright test directly

Rejected for the core format because it would mix the reusable capability with
one surface implementation and make policy, typed outcomes, and desktop
extension harder to express. Code generation can remain a later export.

### Use CSS selectors from the target source

Rejected as the primary strategy because the assignment models legacy systems
where source-level DOM knowledge may be unavailable and where the
accessibility or visual surface is the more realistic contract.

### Add fuzzy locator fallbacks immediately

Deferred. A single exact semantic locator is easier to review and safer for
the first slice. Tenant-specific alternatives should be explicit, versioned,
and tested instead of silently broadening a match.

## Consequences and cuts

Benefits:

- Replay is fast, inspectable, and contains no LLM request path.
- The calling contract and error taxonomy are machine-readable.
- Temporary browser refs never cross the surface boundary into the artifact.
- The same executor handled success and four distinct runtime conditions live.

Trade-offs and current cuts:

- Artifact compilation is human-reviewed rather than generated automatically.
- Version 1 supports only the action and extraction types needed by this slice.
- Visible copy changes can require an artifact version update.
- E01 returns an intervention-ready result but is not yet wired to the live
  handoff controller built for H91.
- Tenant inheritance and locator overrides are designed as future extensions,
  not implemented in this slice.

## Validation

The unit suite covers artifact validation, changing runtime refs, output
redaction, N04, T14, S17, E01, invalid inputs, forbidden origins, and unknown
UI states. Five live headless runs against the deployed target exercised
success, business outcome, successful recovery, hard failure, and human
required. Results are recorded in the
[deterministic replay experiment](../../evidence/replay/deterministic-find-member-2026-09-14.md).
