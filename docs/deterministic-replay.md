# Deterministic replay

The replay path executes a saved capability artifact without making an LLM
request. It uses the same Playwright MCP surface adapter as discovery, but the
artifact—not a model—chooses every step, locator, checkpoint, output, and
runtime outcome.

## Run the capabilities

No API key is needed:

```bash
npm run replay:find-member -- --member-number 100042

npm run replay:read-balance -- \
  --member-number 100042 \
  --account-number S-0042-01

npm run replay:prepare-subaccount -- \
  --member-number 100042 \
  --product HOLIDAY_SAVINGS \
  --nickname "Rainy Day" \
  --opening-deposit 25 \
  --statement-delivery ELECTRONIC

npm run replay:simulate-subaccount -- \
  --member-number 100042 \
  --product REGULAR_SAVINGS \
  --nickname "Emergency Fund" \
  --opening-deposit 40 \
  --statement-delivery PAPER \
  --approve-risky
```

Add `--headed` to watch a deterministic run. To keep a visible H91 review in
the same session while waiting for a supervisor:

```bash
npm run replay:prepare-subaccount -- \
  --member-number 300088 \
  --product REGULAR_SAVINGS \
  --nickname Reserve \
  --opening-deposit 50 \
  --statement-delivery PAPER \
  --wait-for-human
```

The default target is the deployed training app. A locally running target is
also approved by the artifact:

```bash
npm run replay:find-member -- \
  --member-number 100042 \
  --target-url http://localhost:4173
```

`--wait-for-human` implies headed mode. The executor polls the same surface
until the hold disappears and `REVIEW CHECKPOINT` appears. It never invokes a
model. Library callers may provide a human-decision callback; only an explicit
approval permits the declared supervisor action.

## Useful outcome demonstrations

| Input | Structured result |
| --- | --- |
| `100042` | `success` with member number, displayed name, and status |
| `999999` | `business_outcome` / N04 |
| `100099` | T14 is retried once, then `success` |
| `200017` | `failure` / `permission_denied` / S17 |
| `EXPIRED` | `human_required` / E01 |
| `APP-500` | `failure` / `application_error` / X500 |
| Missing account under a valid member | `business_outcome` / `ACCOUNT_NOT_LISTED` |
| Negative opening deposit | `business_outcome` / V22 |
| Member `300088` or deposit of `5000`+ | `human_required` / H91, or same-session resume |
| Simulation without `--approve-risky` | `failure` / `policy_denied` before browser connection |

The command exits `0` for success and expected business outcomes, `1` for a
failure, and `2` when a human is required. The complete structured result is
printed as JSON for the calling agent or process.

## Artifact and evidence

The executable contracts are under `capabilities/`; their serialization rules
are in `capabilities/schema.v1.json`. Runtime evidence is stored under:

```text
evidence/replay/<timestamp>-<capability>-<id>/
├── run.json                    # redacted request and execution mode
├── events.ndjson               # ordered deterministic decisions
├── summary.json                # redacted persisted result
├── failure.png                 # hard failure or intervention context
├── playwright-mcp.stderr.log
└── playwright/                 # fictional target session artifacts
```

The real result is returned to the caller, while persisted member numbers are
masked and names are redacted. All data in the checked-in demonstration target
is fictional.

## Repeatability check

Run three fresh live replays of every capability and compare the stable result,
step list, recovery list, and handoff list:

```bash
npm run replay:stability
```

Run IDs, timings, temporary refs, and timestamps are expected to differ. The
declared result and deterministic decisions must be identical.
