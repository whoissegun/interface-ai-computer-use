# ADR 0002: Preserve the live browser session for human review

- Status: Accepted for Stage 0
- Date: 2026-09-14

## Context

Scenario X2 reaches `HOLD H91`, where the application requires an authorized
supervisor to review the prepared values. Stopping the model is not enough: a
useful harness must preserve the exact page, form state, cookies, and browser
process so a person can take over and the harness can verify what happened.

A headless browser cannot be turned into a visible instance without launching
a different browser. Re-launching would not preserve the exact in-memory
session, so any run that may require a live handoff must be headed from the
start.

## Decision

For explicitly configured human-review scenarios, we will:

1. Run Playwright headed and keep the same `BrowserClient` connected after the
   model stops.
2. Confirm the configured hold text is actually visible before announcing a
   handoff.
3. Freeze model-driven browser mutations as soon as the hold is observed. The
   model may only take a snapshot or screenshot at that boundary.
4. Require the person to review and act directly in the open browser. The
   normal CLI does not click the supervisor control on the person's behalf.
5. Poll read-only accessibility snapshots from the same session.
6. Resume only when both conditions are true: the hold text has disappeared
   and the configured post-review marker is visible.
7. Record the request, observed post-review state, resolution time, and number
   of checks in the run evidence.
8. Stop after verification. Human approval does not authorize the harness to
   perform the separate final-submission action.

The runner also accepts an injected approval callback for controlled tests.
That path records the decision and applies the acknowledgement outside the
model loop. It is not exposed by the normal `stage0:hitl` command; the default
demonstration is direct human interaction.

## Why this boundary is outside the model

The supervisor control represents authority the model does not have. A prompt
alone is not a reliable enforcement mechanism, so the runner applies two code
guards:

- a descriptive guard rejects an attempted click named as the supervisor
  acknowledgement;
- after the H91 text is observed in a browser result, all model-driven browser
  changes are rejected regardless of how the model labels the action.

The second guard matters because model-provided tool descriptions are
untrusted. It also blocks keyboard, navigation, and other indirect attempts to
change the page while the human owns the session.

## Alternatives considered

### Close the browser and give the human a URL

Rejected because the form and transient application state may be lost, and it
would not demonstrate continuity of the original agent session.

### Start headless and reopen headed at the hold

Rejected because Playwright cannot make the existing browser process visible.
A replacement browser would be a new session unless state were exported and
reconstructed, which is weaker than preserving the real session.

### Ask for terminal approval and let automation click

Useful for controlled testing, but not the primary demonstration. Direct
interaction is clearer: reviewers can see that the person, not the model,
performed the privileged action.

### Continue immediately after any page change

Rejected because an unrelated navigation or partial update is not proof that
review succeeded. The harness checks both removal of the hold and presence of
the expected resume marker.

## Consequences

Benefits:

- The person sees and changes the exact browser session created by discovery.
- The model cannot grant itself supervisor authority after H91 is observed.
- Handoff and resume are inspectable events rather than an informal pause.
- A timeout fails closed and prevents the browser from waiting forever.

Trade-offs:

- Potential handoff runs must use a visible browser from the start.
- Snapshot polling adds one read-only browser call per interval.
- The current trigger and resume checks use configured visible text, so target
  UI copy changes require updating the scenario definition.
- Stage 0 verifies the resume boundary but does not yet turn the trajectory
  into a deterministic reusable capability.

## Validation

On 2026-09-14, the X2 flow completed three live handoff runs in fresh browser
sessions. Two used the controlled approval callback; the third used a direct
human click in Chrome. Every run preserved one session, detected the cleared
H91 hold, found the final-submission control, and stopped without performing
final submission. The raw runs and exact measurements are summarized in the
[live handoff experiment](../../evidence/stage0/hitl-2026-09-14.md).
