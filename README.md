# Computer-Use Automation System

A small end-to-end system that lets an LLM discover a workflow in a legacy UI,
turns a successful trace into a typed capability, and replays that capability
deterministically with no model deciding browser actions.

The target is the deployed
[Northstar Legacy Operations](https://target-app-gamma.vercel.app/), a
deliberately awkward fictional credit-union interface with frames, server
forms, cryptic errors, transient failures, a confirmation dialog, and a human
review boundary. It never handles real customer data or performs a real
financial action.

## Architecture at a glance

```text
Discovery
goal + safety profile -> Kimi via OpenRouter -> Playwright MCP -> live UI
                                                     |
                                                     v
                                            recorded trajectory
                                                     |
                                                     v
                                      reviewed trace compiler -> capability JSON

Production
natural-language task -> bounded capability router -> deterministic replay -> typed result
                                                        |
                                                        +-> same-session human handoff
```

The model may explore during discovery. During production replay, the saved
artifact—not the model—chooses every browser action, locator, checkpoint,
retry, and outcome. The optional natural-language router sees only four
high-level business capabilities; it never receives Playwright tools.

## Quick setup

Requirements: Node.js 20 or newer, Google Chrome, and an OpenRouter key for
model-driven discovery or natural-language routing.

```bash
git clone https://github.com/whoissegun/interface-ai-computer-use.git
cd interface-ai-computer-use
npm install
cp .env.example .env
```

Put your key in `.env` as `OPENROUTER_API_KEY`. The default discovery model is
`moonshotai/kimi-k2.6` with high reasoning. The model, reasoning effort, and
target URL can all be overridden by environment variable or CLI flag.

The deployed target is the default. To run it locally in another terminal:

```bash
npm --prefix target-app start
```

The local target is then available at `http://localhost:4173` and requires no
secrets or package installation.

## Exact end-to-end demo

Run discovery on a caller-supplied goal and compile the successful trajectory
to a predictable artifact path:

```bash
npm run stage0 -- \
  --scenario a1 \
  --goal "Find member 100042 and return the displayed name and status. Do not open an account." \
  --emit-artifact \
  --artifact-output tmp/generated/northstar.find-member.json
```

Here `a1` is the reviewed safety profile, not the task itself. Natural-language
goal text cannot add privileges. The current compiler intentionally supports
only the reviewed A1 member-lookup trace shape and fails closed on any unknown
trajectory.

Replay the resulting artifact with no LLM or API key:

```bash
npx tsx src/replay/cli.ts \
  --artifact tmp/generated/northstar.find-member.json \
  --member-number 100042
```

The JSON result reports `success`, the verified displayed member fields, and
the deterministic step sequence. Replay evidence is written under
`evidence/replay/`.

## Run without a live model

A genuine successful discovery trace is checked in, so the compiler and replay
path can be demonstrated without calling OpenRouter:

```bash
npm run artifact:compile -- \
  --run-dir evidence/stage0/2026-09-12T04-42-43-561Z-a1-3ba9b18a \
  --output tmp/generated/offline-find-member.json

npx tsx src/replay/cli.ts \
  --artifact tmp/generated/offline-find-member.json \
  --member-number 100042
```

All automated checks are also offline and do not launch Chrome or spend model
credits:

```bash
npm test
npm run typecheck
npm test --prefix target-app
```

## Other demonstrations

Invoke deterministic capabilities directly:

```bash
npm run replay:find-member -- --member-number 100099

npm run replay:read-balance -- \
  --member-number 100042 \
  --account-number S-0042-01

npm run replay:prepare-subaccount -- \
  --member-number 100042 \
  --product HOLIDAY_SAVINGS \
  --nickname "Rainy Day" \
  --opening-deposit 25 \
  --statement-delivery ELECTRONIC
```

Route a natural-language request to those capabilities:

```bash
npm run agent -- --task \
  "For member 100042, read the available balance of account S-0042-01."
```

Exercise the same-session human handoff. A visible Chrome window pauses at
`HOLD H91`; after a supervisor acknowledges the review in that browser, the
deterministic executor resumes and verifies the checkpoint:

```bash
npm run replay:prepare-subaccount -- \
  --member-number 300088 \
  --product REGULAR_SAVINGS \
  --nickname Reserve \
  --opening-deposit 50 \
  --statement-delivery PAPER \
  --wait-for-human
```

## Reviewer path

- [REPORT.md](./REPORT.md) explains the architecture, artifact, determinism,
  portability, handoff, safety, and deliberate cuts.
- [Evidence guide](./evidence/README.md) points to the useful summaries and a
  small set of representative raw runs. It includes 39 isolated discovery
  runs, three fresh replays per capability, human handoff proof, and a 9/9
  natural-language routing evaluation.
- [Stage 0 runner](./docs/stage-0-runner.md) documents discovery, custom goals,
  tool policy, and compilation.
- [Deterministic replay](./docs/deterministic-replay.md) lists commands and the
  typed outcome taxonomy.
- [Capability agent](./docs/capability-agent.md) explains bounded routing,
  ambiguity, and its three-call ceiling.
- [Decision records](./docs/decisions/) capture the tradeoffs as the system was
  built.

## Repository map

```text
capabilities/       versioned JSON artifacts and schema
config/             complete Playwright MCP tool policy
docs/               guides and architecture decision records
evidence/           human summaries plus selected machine-readable runs
src/stage0/         model-driven discovery and conservative trace compiler
src/replay/         deterministic executor and typed outcomes
src/agent/          bounded natural-language capability router
src/surface/        browser-surface abstraction
target-app/         independently runnable legacy training application
```

## Current boundary

The system proves one fully automatic discovery-to-artifact vertical slice and
four human-reviewed deterministic capabilities. It does not claim that one
successful trace can safely synthesize an arbitrary production workflow. New
operations require a reviewed compiler profile or a reviewed artifact, and
real credentials, real writes, multi-tenant rollout, and a full operator
console are intentionally out of scope.
