# Stage 0 Discovery Plan

## Purpose

Stage 0 is a controlled exploration of the target website before we design the
reusable capability format or deterministic replay engine.

We will give a capable model access to the website through Playwright MCP. For
each task, we will record what the model observed, which browser actions it
used, and the result it reached. These runs give us evidence for the smallest
useful browser-action interface our own harness needs.

Stage 0 is research for the implementation. It is not a substitute for the
assignment's later LLM-driven discovery run, which must produce a typed,
versioned capability that can be replayed without a model.

## Target application

The target is the fictional Northstar Legacy Operations website:

<https://target-app-gamma.vercel.app/>

It deliberately behaves like an old back-office banking system: it uses HTML
frames, server-rendered forms, table-heavy pages, redirects, cryptic field
names, function-key language, interstitial error screens, and a native browser
confirmation dialog. All people, accounts, balances, and submissions are fake.

## Business capabilities

The website has four normal business capabilities that are useful for browser
automation discovery.

| ID | Capability | What a successful run proves |
| --- | --- | --- |
| C1 | Find a member | The agent can navigate frames, fill a lookup form, submit it, and identify the returned member. |
| C2 | Read an account balance | The agent can continue from a member record, open the correct account, and extract a requested value. |
| C3 | Prepare a savings sub-account | The agent can navigate a multi-step form, select values, enter data, and stop at a review boundary. |
| C4 | Simulate account submission | The agent can cross an explicitly authorized final-action boundary, handle a native confirmation dialog, and read the receipt. |

These are business capabilities, not browser actuators. The actuators are the
lower-level actions used to perform them, such as navigating, clicking, typing,
selecting an option, waiting, reading a page snapshot, and handling a dialog.

## Exceptional paths

Exceptional paths test whether the agent recognizes that a visible result is
not always a successful completion.

| ID | Input or condition | Expected outcome | Proposed classification |
| --- | --- | --- | --- |
| E1 | Unknown member `999999` | `BUSINESS RESULT N04` | Expected business outcome |
| E2 | Blank member number | `VALIDATION V10` | Expected business outcome |
| E3 | Invalid product or deposit | `VALIDATION V22` | Expected business outcome |
| E4 | Member `100099` | A `503`/`T14` interstitial appears; using its Retry link succeeds | Recoverable condition |
| E5 | Member `200017` | `403 SECURITY S17` | Hard failure |
| E6 | Member `EXPIRED` | `401 SESSION E01` | Human sign-in required |
| E7 | Member `APP-500` | `500 HOST X500` | Hard failure |
| E8 | Member `300088`, or deposit at least `5000` | `HOLD H91` blocks submission | Human intervention required |

## Atomic discovery tasks

Each run starts in a fresh browser session and receives only one task. These
prompts are intentionally written as user goals rather than UI instructions.

### A1 — Find a member

> In the Northstar training system, find member 100042. Report the member's
> displayed name and stop without opening an account or starting another
> operation.

Expected result: the agent reports `Avery Example`.

### A2 — Read a balance

> Find member 100042, open savings account S-0042-01, and report its available
> balance. Do not start a new-account operation.

Expected result: the agent reports `$2,381.37` as the available balance.

### A3 — Prepare a sub-account

> Prepare a Holiday Savings sub-account for member 100042 with nickname
> "Rainy Day", an opening deposit of CAD 25, and electronic statements. Stop at
> the final review screen without submitting. Report the details shown for
> review.

Expected result: the review screen shows the requested member, product,
nickname, deposit, and statement choice. No simulated submission occurs.

### A4 — Simulate submission

> Open a Regular Savings sub-account for member 100042 with nickname
> "Emergency Fund", an opening deposit of CAD 40, and paper statements. This is
> a fictional training system: you are authorized to use SIMULATE FINAL
> SUBMISSION and confirm its browser dialog. Report the resulting training
> reference.

Expected result: the agent reaches `SIMULATED SUCCESS` and reports the fake
`TRAIN-...` reference.

## Exceptional discovery tasks

We will begin with two representative exceptions. The remaining cases can be
added after the basic runner is stable.

### X1 — Recoverable interruption

> Find member 100099 and report the member's displayed name. If the system
> presents a temporary recoverable condition, use the recovery offered by the
> page and continue.

Expected result: the agent recognizes `T14` as recoverable, uses Retry, and
reports `Morgan Mockdata`.

### X2 — Human-review boundary

> Prepare a Regular Savings sub-account for member 300088 with nickname
> "Reserve", an opening deposit of CAD 50, and paper statements. Stop when the
> task either reaches a final review ready for submission or requires a human.
> Do not claim that the account was submitted.

Expected result: the agent stops at `HOLD H91`, reports that human review is
required, and does not attempt to bypass or misreport the hold.

## Chained discovery task

The chained task tests whether the actions observed in the atomic runs are
enough when several capabilities must be coordinated in one session.

> In the Northstar training system, find member 100042 and report the available
> balance of savings account S-0042-01. Then prepare a Holiday Savings
> sub-account for the same member with nickname "Rainy Day", an opening deposit
> of CAD 25, and electronic statements. Stop at the final review screen without
> submitting. Report both the available balance and every displayed review
> detail.

Expected result: the agent reports the `$2,381.37` available balance, preserves
the member context, reaches the correct final review, and does not submit.

## What every run records

For every atomic, exceptional, and chained run, the Stage 0 runner should save:

- the exact task prompt, target URL, model, model settings, and start time;
- the browser tools offered to the model;
- each model decision and requested tool call in order;
- each tool result needed to understand the next decision;
- screenshots or browser snapshots at meaningful checkpoints;
- elapsed time, model usage where available, and total step count;
- the final model report and the runner's completion status; and
- failures and redactions without recording the OpenRouter API key.

Each run should have its own evidence directory so that another engineer can
inspect and compare trajectories.

## How we evaluate Stage 0

Stage 0 is complete when:

1. Every selected task has an inspectable trajectory, not merely a final
   answer.
2. We can list the browser actions that were actually used and explain why each
   one is needed.
3. The chained run either uses the union of actions observed in the atomic runs
   or clearly identifies a missing action or orchestration feature.
4. The agent distinguishes success, expected business outcomes, recoverable
   conditions, hard failures, and human-review boundaries.
5. We can use the evidence to design our own narrow actuator interface and the
   first typed capability in the next stage.

Stage 0 does not prove deterministic replay. It reduces guesswork before we
implement and test replay.
