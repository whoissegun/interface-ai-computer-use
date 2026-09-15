# Stage 0 Runner

The Stage 0 runner connects an OpenRouter model to the official Playwright MCP
server. It records an inspectable browser trajectory for one scenario at a
time. For the end-to-end `a1` vertical slice, it can compile a successful
trajectory into a validated reusable capability. Deterministic replay remains
a separate execution path.

## Setup

Requirements:

- Node.js 20 or newer
- Google Chrome
- an OpenRouter API key with access to the configured model

Install the pinned dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env
```

Replace the example `OPENROUTER_API_KEY` value in `.env`. The real `.env` is
ignored by Git.

## See available scenarios

```bash
npm run stage0 -- --list
```

## Run a natural-language goal

Pass the requested work with `--goal`. The scenario is a reviewed safety
profile: it defines permissions and any handoff boundary, while the goal tells
the model what to do. Goal text cannot widen those permissions.

```bash
npm run stage0 -- \
  --scenario a1 \
  --goal "Find member 100042 and return the displayed name and status. Do not open an account."
```

Omit `--goal` to use the safety profile's built-in evaluation prompt.

Use `--headed` to watch the browser:

```bash
npm run stage0 -- --scenario a1 --goal "Find member 100042." --headed
```

## Record and compile a capability

Add `--emit-artifact` to compile a successful `a1` discovery trajectory. The
generated `capability.json` and `artifact-compilation.json` are written inside
the new evidence run:

```bash
npm run stage0 -- --scenario a1 --emit-artifact
```

Use `--artifact-output` when a second copy is needed at a predictable path:

```bash
npm run stage0 -- \
  --scenario a1 \
  --goal "Find member 100042 and return the displayed name and status." \
  --emit-artifact \
  --artifact-output tmp/generated/northstar.find-member.json
```

Compilation is deterministic and deliberately conservative. It recognizes the
reviewed A1 action pattern, derives stable accessible names from the recorded
operator-facing element descriptions, parameterizes the sample member number,
discards temporary Playwright refs, verifies the observed checkpoint, and then
validates the artifact against `capabilities/schema.v1.json`. A failed run,
unknown action, reordered flow, missing checkpoint, or unsupported scenario
produces no artifact.

An already-recorded run can be compiled without another model call:

```bash
npm run artifact:compile -- \
  --run-dir evidence/stage0/2026-09-12T04-42-43-561Z-a1-3ba9b18a
```

The compiler currently supports only A1. Adding another operation requires a
new reviewed contract profile for its typed inputs, outputs, outcomes,
checkpoint, and risk policy; the system does not guess those safety-relevant
details from a single successful trace.

## Run the live human handoff

Scenario `x2` can pause at `HOLD H91` and keep its exact headed browser session
open for a supervisor:

```bash
npm run stage0:hitl
```

The model is forbidden by policy from clicking the supervisor acknowledgement.
When the hold appears, the terminal prints `NEEDS HUMAN`. A person reviews the
visible values and clicks `Supervisor: acknowledge review` directly in Chrome.
The harness watches without modifying the page and resumes only after it
verifies that `HOLD H91` disappeared and `SIMULATE FINAL SUBMISSION` became
visible in that exact browser session. It verifies and stops there; it does not
perform the final simulated submission. The default handoff timeout is 15
minutes; use `--human-timeout-ms` and `--human-poll-ms` to override it.

Kimi K2.6 with high reasoning is the reproducible default. Override the model
without changing code:

```bash
npm run stage0 -- --scenario a1 --model <openrouter-model-id>
```

Other useful controls are `--reasoning-effort`, `--max-steps`, `--max-tokens`,
and `--target-url`.

## Evidence layout

Every execution creates a unique directory under `evidence/stage0/`:

```text
evidence/stage0/<timestamp>-<scenario>-<id>/
├── run.json
├── discovered-tools.json
├── offered-tools.json
├── withheld-tools.json
├── events.ndjson
├── summary.json
├── capability.json             # when --emit-artifact is used
├── artifact-compilation.json   # recognized/ignored calls and validation
├── playwright-mcp.stderr.log
├── tool-*.png                  # when an image-producing tool is used
└── playwright/                 # Playwright MCP session artifacts
```

`discovered-tools.json` contains every tool returned by the pinned Playwright
MCP server. `offered-tools.json` contains the filtered definitions sent to the
model. `withheld-tools.json` contains the excluded definitions and a reason for
every exclusion. The authoritative policy is
`config/stage0-playwright-tool-policy.json`.

`events.ndjson` is the ordered trajectory. `summary.json` is the quick result,
including the used-tool counts, token use, cost when reported, and elapsed
time. The runner redacts the configured API key from evidence and logs.

## Safety boundaries

- Playwright uses a fresh isolated browser context for every run.
- Direct navigation is restricted to the configured target origin.
- Arbitrary JavaScript evaluation and file upload are not offered to the
  model.
- `--goal` text cannot change the selected profile's safety permissions.
- Only safety profile `a4` authorizes accepting the fake final-submission dialog.
- Supervisor acknowledgement is always blocked from model tool calls and must
  be clicked by a person in the live browser.
- Tool calls are capped, and each run has a model-response timeout.
- Model-provided artifact filenames are rewritten into the current evidence
  directory to prevent concurrent runs from overwriting one another.
- The target app contains only fictional training data and simulated writes.

## Verification

```bash
npm run typecheck
npm test
```

The unit tests use fake model and browser clients. They do not spend OpenRouter
credits or launch Chrome.
