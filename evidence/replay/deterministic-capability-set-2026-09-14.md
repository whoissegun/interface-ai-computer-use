# Deterministic capability-set evidence — 2026-09-14

## Result

All four capabilities replayed against the deployed training target with no
LLM in the decision loop. The stability runner completed three fresh success
runs per capability (12/12 total), and each capability produced one identical
stable result across its three runs.

The machine-readable comparison is
`stability-2026-09-15T03-15-35-201Z.json`. Its timestamp is UTC; the experiment
date in America/Toronto was 2026-09-14.

| Capability | Repetitions | Consistent | Stable outcome |
| --- | ---: | --- | --- |
| `northstar.find-member@1.0.0` | 3 | Yes | Verified member 100042 |
| `northstar.read-balance@1.0.0` | 3 | Yes | Verified S-0042-01 and numeric balances |
| `northstar.prepare-subaccount@1.0.0` | 3 | Yes | Verified review for the prepared draft |
| `northstar.simulate-subaccount@1.0.0` | 3 | Yes | `TRAIN-100042-004000` safe simulation receipt |

## Non-happy-path live runs

| Run ID | Expected classification | Observed |
| --- | --- | --- |
| `2026-09-15T03-08-37-053Z-northstar-read-balance-d9507b8d` | Requested account absent under member | `business_outcome / ACCOUNT_NOT_LISTED` |
| `2026-09-15T03-08-48-469Z-northstar-prepare-subaccount-cb3c6970` | Negative opening deposit | `business_outcome / V22` |
| `2026-09-15T03-08-52-740Z-northstar-simulate-subaccount-cc39c9bd` | No risky-action approval | `failure / policy_denied`, zero browser steps |
| `2026-09-15T03-11-37-250Z-northstar-prepare-subaccount-a59548ce` | H91 with no intervention before timeout | `human_required / H91` with screenshot |
| `2026-09-15T03-13-59-937Z-northstar-prepare-subaccount-9980432b` | H91 with controlled approval | Resumed in the same session and succeeded |
| `2026-09-15T03-18-03-590Z-northstar-read-balance-9adb13f7` | T14 during balance flow | One bounded retry, then success |
| `2026-09-15T03-18-07-277Z-northstar-prepare-subaccount-73e3302c` | T14 during preparation flow | One bounded retry, then success |

The earlier find-member experiment covers N04, T14 recovery, S17, E01, X500,
unknown UI, and mismatched-member assertions. The shared executor and outcome
interpreter are used by every artifact.

## What was compared

The stability comparison includes capability ID/version, structured status and
outputs, completed step IDs, recoveries, and human-handoff records. It excludes
timestamps, duration, random run ID, and temporary accessibility refs because
those are execution metadata rather than capability decisions.
