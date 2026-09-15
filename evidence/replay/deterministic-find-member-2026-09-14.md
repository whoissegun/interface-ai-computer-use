# Deterministic Find Member Experiment — 2026-09-14

## Method

- Capability: `northstar.find-member@1.0.0`
- Target: <https://target-app-gamma.vercel.app/>
- Surface: isolated headless Chrome through Playwright MCP
- Decision maker: the saved JSON artifact; no LLM request or API key
- Repetitions: one fresh browser session for each representative outcome

## Results

| Input | Run | Result | Time |
| --- | --- | --- | ---: |
| `100042` | `2026-09-14T20-25-17-613Z-northstar-find-member-baef0da4` | Success; returned Avery Example / Active | 2.776 s |
| `999999` | `2026-09-14T20-25-26-717Z-northstar-find-member-be6c5a1c` | Business outcome N04 | 3.016 s |
| `100099` | `2026-09-14T20-25-26-724Z-northstar-find-member-0edf0348` | Recovered T14 once, then returned Morgan Mockdata / Active | 4.253 s |
| `200017` | `2026-09-14T20-25-26-724Z-northstar-find-member-1f413b7b` | Hard failure: permission denied S17 | 2.970 s |
| `EXPIRED` | `2026-09-14T20-25-26-722Z-northstar-find-member-82d7e3ff` | Human required: expired session E01 | 3.021 s |

All five results matched the artifact’s declared outcome. The T14 run executed
exactly one bounded recovery step. S17 and E01 captured `failure.png` as richer
evidence. No run called OpenRouter or included a model in its decision path.

For comparison, one retained A1 discovery run took 21.197 seconds, used 31,469
tokens, and cost about `$0.00985`. The equivalent successful replay took 2.776
seconds and had no model cost. This small sample demonstrates the intended
direction; it is not a performance benchmark.

## Privacy check

`run.json` masks member inputs to their final four characters. Successful
`summary.json` files also mask the returned member number and replace the
displayed name with `[REDACTED]`. The caller still receives the real typed
output on stdout. The retained Playwright artifacts and screenshots contain
only the target application’s explicitly fictional training data.
