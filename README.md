# Computer-Use Automation System

Take-home project for the interface.ai Software Engineer application.

Project design and implementation details will be added after reviewing the assignment brief.

The independently runnable fictional legacy UI target lives in [target-app](./target-app/README.md). The discovery and deterministic replay harness will remain separate from it.

The planned capabilities, scenarios, prompts, and evidence criteria for the
initial browser exploration are documented in the
[Stage 0 discovery plan](./docs/stage-0-discovery-plan.md).

The executable exploration harness and its commands are described in the
[Stage 0 runner guide](./docs/stage-0-runner.md). The reasoning behind the
browser and model choices is recorded in
[ADR 0001](./docs/decisions/0001-stage-0-discovery-approach.md).

The same-session human-review design, safety boundary, alternatives, and
validation are recorded in
[ADR 0002](./docs/decisions/0002-live-human-handoff.md).

Four production-style artifacts cover every core operation in the target:
member lookup, balance inquiry, prepare-to-review, and safe final simulation.
Run the first deterministically, without an LLM or API key, with:

```bash
npm run replay:find-member -- --member-number 100042
```

The replay commands and outcome examples are in the
[deterministic replay guide](./docs/deterministic-replay.md). The artifact,
locator, checkpoint, error-taxonomy, and redaction decisions are recorded in
[ADR 0003](./docs/decisions/0003-versioned-capability-and-deterministic-replay.md).
The multi-capability composition, final-action gate, same-session H91 behavior,
and stability criteria are recorded in
[ADR 0004](./docs/decisions/0004-deterministic-capability-set-and-safety-gates.md).

The checked-in live stability report contains three consistent fresh replays
of each capability:

```bash
npm run replay:stability
```

The natural-language layer exposes those artifacts as four business tools to a
bounded routing model. Browser actions and human handoff remain deterministic
and are never offered to that model:

```bash
npm run agent -- --task \
  "For member 100042, read the available balance of account S-0042-01."
```

Usage, safety behavior, and examples are in the
[capability-agent guide](./docs/capability-agent.md). The orchestration boundary
and three-call ceiling are recorded in
[ADR 0005](./docs/decisions/0005-bounded-natural-language-capability-routing.md).
