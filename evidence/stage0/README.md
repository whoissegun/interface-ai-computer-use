# Stage 0 Evidence

This directory contains raw, inspectable discovery trajectories. Each run has
its exact configuration, offered browser tools, ordered event stream, summary,
and Playwright MCP artifacts.

The repeated 39-run experiment is summarized in
[Stage 0 Stability Experiment — 2026-09-14](./stability-2026-09-14.md).

## First atomic task: A1

| Run | Model | Outcome | Finding |
| --- | --- | --- | --- |
| `2026-09-12T04-41-10-360Z-a1-728e5b6d` | `anthropic/claude-opus-5` | Refused before browser use | Anthropic's provider filter classified the fictional member-lookup browser task as restricted cyber content. No tool was called and no usage was billed in the response. |
| `2026-09-12T04-42-43-561Z-a1-3ba9b18a` | `moonshotai/kimi-k2.6` | Completed | Reported `Avery Example` after 9 browser actions in about 21 seconds. OpenRouter reported 40,240 tokens and a cost of approximately $0.0128. |

The successful A1 run used this actuator subset:

| Browser action | Calls | Why it was used |
| --- | ---: | --- |
| `browser_navigate` | 1 | Open the target application. |
| `browser_snapshot` | 3 | Observe the framed UI and verify the final member record. |
| `browser_click` | 2 | Choose Member Lookup and submit the form. |
| `browser_wait_for` | 2 | Allow frame navigation and the submitted result to settle. |
| `browser_type` | 1 | Enter member number `100042`. |

This is one trajectory, not yet a claim that all five actions are strictly
necessary. Later atomic runs and the chained run will show whether actions such
as explicit waiting can be removed or whether other actions are required.
