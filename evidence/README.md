# Evidence guide

This directory contains the raw and summarized proof for the end-to-end system:
an LLM discovers how to complete work in the live training UI, the learned flow
becomes a typed capability, and the capability replays without an LLM making
browser decisions.

Reviewers do not need to read every raw Playwright file. Start with the short
path below, then open an individual run only when inspecting its ordered events,
browser snapshots, screenshot, or final result.

## Recommended review path

1. **Genuine LLM discovery.** Read the
   [Stage 0 overview](./stage0/README.md), then inspect the successful
   [Kimi member-lookup run](./stage0/2026-09-12T04-42-43-561Z-a1-3ba9b18a/).
   Its event stream records the model's observe-decide-act trajectory against
   the live target.
2. **Discovery coverage and stability.** Read the
   [39-run discovery summary](./stage0/stability-2026-09-14.md). It covers four
   business tasks, runtime errors, transient recovery, policy enforcement, and
   a chained task across three fresh sessions per scenario.
3. **Typed capability.** Review
   [`northstar.find-member@1.0.0`](../capabilities/northstar.find-member.v1.json)
   alongside the shared
   [artifact schema](../capabilities/schema.v1.json). The other checked-in
   capabilities are listed below.
4. **Deterministic replay.** Read the
   [five-outcome replay summary](./replay/deterministic-find-member-2026-09-14.md)
   and compare these representative runs:
   - [success](./replay/2026-09-14T20-25-17-613Z-northstar-find-member-baef0da4/),
   - [N04 member-not-found business outcome](./replay/2026-09-14T20-25-26-717Z-northstar-find-member-be6c5a1c/),
   - [T14 transient recovery](./replay/2026-09-14T20-25-26-724Z-northstar-find-member-0edf0348/), and
   - [S17 permission failure](./replay/2026-09-14T20-25-26-724Z-northstar-find-member-1f413b7b/).
5. **Live human handoff.** Read the
   [handoff experiment](./stage0/hitl-2026-09-14.md), then inspect the run where
   [a person operated the same Chrome session](./stage0/2026-09-14T19-54-59-177Z-x2-a8df0f56/).
   The deterministic replay path is represented by this
   [same-session H91 resume run](./replay/2026-09-15T03-13-59-937Z-northstar-prepare-subaccount-9980432b/).
6. **Agent-facing invocation.** Read the
   [natural-language routing summary](./agent/natural-language-routing-2026-09-14.md)
   and its final
   [9/9 machine-readable report](./agent/evaluation-2026-09-15T04-02-38-910Z.json).
   These cases cover clear, informal, chained, ambiguous, conflicting, risky,
   and human-review requests.

## Saved capability artifacts

| Capability | Purpose |
| --- | --- |
| [`northstar.find-member@1.0.0`](../capabilities/northstar.find-member.v1.json) | Find and verify a member. |
| [`northstar.read-balance@1.0.0`](../capabilities/northstar.read-balance.v1.json) | Read typed ledger and available balances. |
| [`northstar.prepare-subaccount@1.0.0`](../capabilities/northstar.prepare-subaccount.v1.json) | Prepare a sub-account and stop at verified review. |
| [`northstar.simulate-subaccount@1.0.0`](../capabilities/northstar.simulate-subaccount.v1.json) | Perform the explicitly approved training-only final simulation. |

## What the raw run folders contain

Depending on the run type, a folder contains:

- `run.json`: configuration, target, model or capability version, and redacted
  inputs;
- `events.ndjson`: the ordered structured event stream;
- `summary.json`: the typed final status, outputs, recovery, or failure;
- `playwright/`: accessibility snapshots and the Playwright MCP session record;
- `failure.png`: a richer visual signal for selected failure or
  human-required states.

The raw runs are intentionally retained for auditability and deeper debugging.
The Markdown summaries and this guide are the human-readable entry points.
All target records are explicitly fictional training data; persisted capability
inputs and outputs follow their declared masking or redaction policy.
