# Design report

## Architecture

The system separates learning a workflow from running it. During discovery, a
caller supplies a natural-language goal plus a reviewed safety profile. Kimi
K2.6, reached through OpenRouter, observes accessibility snapshots and chooses
from a filtered set of Playwright MCP tools. Every model turn, tool call, tool
result, snapshot, timing, and outcome is recorded. A fresh browser context is
used for every run.

A conservative compiler can turn the recognized A1 member-lookup trajectory
into a validated capability artifact. This is intentionally a reviewed
vertical slice rather than a claim that arbitrary traces are safe programs.
The other three core capabilities were compiled from three stable discovery
runs each and reviewed before check-in.

Production takes a different path. The replay executor loads an artifact,
validates it, checks its inputs and origin, and executes its declared steps
through a `SurfaceClient`. No LLM chooses browser actions. An optional bounded
router lets callers phrase tasks naturally, but it sees only high-level tools
such as `find_member` and `read_balance`; those tools dispatch to deterministic
replay. The router cannot see or call Playwright.

OpenRouter keeps model choice configurable. Opus 5 was the initial research-led
candidate, but its route refused the fictional first task before using a tool.
Kimi then delivered the expected outcome in 37 of 39 discovery runs across the
complete matrix. The two misses exposed a screenshot limitation and ambiguous
wording rather than a missing actuator, so Kimi became the reproducible
default while those misses stayed visible. The reasoning and evidence are in
[ADR 0001](./docs/decisions/0001-stage-0-discovery-approach.md).

## Artifact schema

Capabilities are versioned JSON documents checked against
[`capabilities/schema.v1.json`](./capabilities/schema.v1.json). Each artifact
declares its identity and semantic version, provenance, supported surface and
origins, risk level, typed inputs and outputs, ordered steps, completion
checkpoint, known outcomes, and cross-field assertions. A version is immutable
after approval.

Locators use stable accessibility relationships: role plus accessible name, or
a control near stable visible text. They include a plain-language rationale.
Temporary Playwright refs are never serialized because they change in every
browser session. Sample values from discovery become typed placeholders, and
each input/output defines whether evidence may store it plainly, mask it, or
redact it.

The A1 compiler reads the ordered recorded calls, accepts only the reviewed
action sequence and checkpoint, ignores observation-only snapshots, replaces
the demonstrated member number with an input, and validates the result. It
emits an inspection report showing recognized and ignored calls. Failed,
reordered, incomplete, or unknown traces produce no artifact. Generated
artifacts identify their provenance as `reviewed_trace_compiler`; the broader
checked-in set identifies the discovery runs used for human review.

## Determinism & error handling

Replay is deterministic in the meaningful sense: for a capability version,
typed input, and target version, the artifact fixes the actions, locator
strategy, checkpoints, retry limits, and outcome classification. Runtime refs,
timestamps, and network timing may differ. The executor takes a fresh
accessibility snapshot before resolving each control and verifies both
intermediate and final visible checkpoints. It also asserts that returned
identity fields match the request so a visually plausible wrong record cannot
count as success.

Outcomes are structured rather than flattened into exceptions. N04 and
validation codes such as V22 are expected `business_outcome` results. T14 is a
recoverable interruption with exactly one artifact-declared retry. S17 and
X500 are hard failures. E01 and H91 are `human_required`. An unknown page,
missing locator, wrong member, exhausted retry, invalid input, unapproved
origin, or absent risky-action confirmation fails with a debuggable typed
result.

The evidence includes 39 fresh discovery runs—three per atomic, failure,
recovery, handoff, and chained scenario—and three fresh deterministic replays
of each of the four capabilities. Stable outputs, step sequences, recovery
decisions, and handoff decisions are compared while run IDs and timings are
allowed to vary. Unit tests use fake surfaces to cover success and unhappy
paths without Chrome or an API key.

## Heterogeneity & multi-tenant

The executor depends on the small `SurfaceClient` boundary, not directly on
the discovery loop. The present adapter uses Playwright MCP and the artifact
surface kind is explicitly `web_accessibility`. A desktop adapter could expose
the same snapshot, click, type, select, key, and dialog operations through an
OS accessibility tree, with coordinate/vision fallback kept surface-specific.
Artifacts should not pretend a web locator is portable to a desktop screen;
the schema would add a versioned locator variant and the capability would name
its supported surface.

For multiple tenants or vendor versions, the base capability should remain one
reviewed contract. Tenant configuration would select allowed origins,
credentials, application fingerprint, and small constrained locator overrides
instead of copying and editing the whole program. Before replay, a lightweight
fingerprint and checkpoint probe should confirm that the expected application
version is present. Rollout would use tenant canaries, typed mismatch metrics,
and automatic disablement after repeated UI mismatches. A changed workflow or
risk contract requires a new capability version; a harmless tenant label
change may use a reviewed override.

## Escalation & handoff

H91 demonstrates a real same-session handoff. In discovery, the policy detects
the visible hold and freezes model-driven mutations. In deterministic replay,
the executor returns a typed intervention request or, when explicitly run in
wait mode, keeps the exact headed Chrome context alive. The terminal explains
what the supervisor must inspect. The person acknowledges the review in that
browser, and the harness only observes until the hold disappears and the
declared resume checkpoint appears. It then resumes deterministically.

The controller therefore has clear automation, waiting-for-human, and resumed
states. The model does not approve, perform, or infer the human action. A
production operator console could attach to the held browser session, show the
reason and audit context, enforce identity/role checks, accept approve or
reject, and time out safely. The current visible browser plus terminal is the
smallest implementation that proves session continuity and control ownership.

## Safety

Defense is layered. Discovery starts from the complete pinned Playwright MCP
tool inventory, with a checked-in decision for every tool. High-power tools
such as arbitrary JavaScript evaluation and file upload are withheld. Direct
navigation and newly opened tabs are restricted to the target origin. Model
steps and tokens are capped, and evidence redacts the API key.

The selected safety profile—not goal wording—controls discovery permissions.
Only A4 may accept the fictional final-submission dialog, and supervisor
acknowledgement is always reserved for a human. On the production path, risky
simulation is absent from the router's tool list unless the host supplies
external approval; the replay executor independently checks the same approval
before opening the browser. It verifies review values immediately before the
final click and handles only the declared dialog.

Artifacts have action allowlists, typed inputs, origin allowlists, expected
pages, checkpoints, and explicit outcome/retry rules. Evidence masks member
numbers and redacts names according to the artifact policy. All target data and
writes are fictional. The demo target's unsigned workflow cookie is suitable
only for this training system and is documented as a deliberate non-production
boundary.

## Cuts

The deliberate cuts preserve the core argument. Automatic trace compilation is
implemented only for A1 because inferring schemas, risk, retries, and business
meaning from one successful trace would be unsafe. Extending it means adding a
reviewed profile for each operation, then comparing several successful and
failure trajectories before approval. There is no LLM fallback inside replay;
a UI mismatch stops rather than silently switching control modes.

The project does not implement real authentication, credentials, financial
writes, a remote browser fleet, queues, concurrency control, a graphical
operator console, desktop adapters, or the multi-tenant configuration service
described above. Final submission exists only as a deterministic training
simulation. The chosen optional extensions are the agent-facing capability API
and multi-run stability evidence because they directly test whether the saved
capabilities are usable and repeatable.

Given more time, the next priorities would be reviewed compiler profiles for
the other three operations, UI fingerprint/drift detection, signed and
role-checked handoff approvals, and canary/rollback controls. Only after those
would it be sensible to consider a tightly bounded model-assisted recovery
path, and any newly discovered sequence would still require review before it
could become an executable capability.
