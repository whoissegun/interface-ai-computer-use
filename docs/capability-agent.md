# Natural-language capability agent

The agent understands a natural-language task, chooses from the approved
business capabilities, and turns their typed results into a concise response.
It does not receive Playwright tools and does not decide browser actions.

## Run

Add a local `OPENROUTER_API_KEY` to `.env`, then run:

```bash
npm run agent -- --task \
  "For member 100042, read the available balance of account S-0042-01."
```

The default routing model is `moonshotai/kimi-k2.6` with medium reasoning. The
model and target can be changed through the documented environment variables
or CLI flags.

## Available tools

| Tool | Deterministic artifact |
| --- | --- |
| `find_member` | `northstar.find-member@1.0.0` |
| `read_balance` | `northstar.read-balance@1.0.0` |
| `prepare_subaccount` | `northstar.prepare-subaccount@1.0.0` |
| `simulate_subaccount` | `northstar.simulate-subaccount@1.0.0` |

Tool parameter schemas are generated from the capability artifacts. This keeps
the model-facing input contract and the replay validator aligned.

`simulate_subaccount` is not offered unless the host supplies external
approval:

```bash
npm run agent -- \
  --approve-risky \
  --task "Simulate final submission for member 100042: Regular Savings, nickname Emergency Fund, CAD 40 opening deposit, paper statements."
```

Natural-language wording alone cannot grant this approval. Even when the tool
is exposed, the deterministic replay executor independently checks the same
approval before opening a browser.

## Bounded loop

One model turn may select one or more capabilities. Each selected capability
is executed sequentially and its compact typed result is returned to the
model. The default and hard maximum is three capability calls. The current
longest intended task uses two calls, leaving one-call margin without allowing
an open-ended loop.

The harness rejects identical repeated calls. After a business outcome, human
requirement, or failure, later calls in the same response are rejected and the
next model turn receives no tools, so it can only summarize the result. A
request beyond the call ceiling returns `call_limit`.

## Ambiguity

The router is instructed to tolerate spelling errors, abbreviations, and
informal language when every typed input is clear. It asks a concise question
without opening a browser when a required value is missing or two values
conflict.

For example, “check the balance for member 100042” is missing the account
number. “Use both CAD 25 and CAD 40 as the opening deposit” has a conflict.
Neither request invokes a capability.

## Human intervention

HITL is not controlled by the routing model. If deterministic replay reaches
H91, the replay executor pauses, emits the instructions, holds the same browser
session, and observes the resume checkpoint. The model receives only the
finished result.

Use `--wait-for-human` to keep the visible session open. It implies headed
browser mode. Without wait mode, H91 returns as a typed `human_required` result
which the agent may summarize.

## Evidence

Agent runs are stored under `evidence/agent/<run-id>/`. Each run contains the
original test task, offered capability names and versions, redacted routing
events, a summary, and nested deterministic replay evidence for executed
capabilities.

Run the checked-in evaluation set with:

```bash
npm run agent:evaluate
```

The evaluation asserts both the capability-call sequence and key facts in the
final answer.
