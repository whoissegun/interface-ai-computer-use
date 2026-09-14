# ADR 0001: Use an isolated Playwright MCP browser and a strong discovery model

- Status: Accepted for Stage 0
- Date: 2026-09-12

## Context

Before defining our own browser actuator interface, we need evidence showing
which low-level browser actions real tasks require. A private browser extension
or a developer's personal Chrome profile would make exploration convenient but
would leave reviewers unable to reproduce how the model interacted with the
target.

Stage 0 also has a different optimization goal from production replay. Here we
want the best chance of discovering a correct path through an unfamiliar,
awkward UI. Later stages must turn a successful path into a deterministic,
no-model capability and can evaluate smaller or cheaper models for discovery.

## Decision

We will:

1. Run the official Playwright MCP server from a pinned project dependency.
2. Give every scenario a fresh isolated Chrome browser context.
3. Connect Playwright MCP to OpenRouter with a small tool-calling loop written
   in this repository.
4. Default Stage 0 discovery to `anthropic/claude-opus-5` with high reasoning.
5. Keep the model configurable so the same scenarios can later compare Opus,
   Kimi K2.6, and other tool-capable models.
6. Save the prompt, offered tools, model turns, tool calls, tool results,
   snapshots/images, usage, timing, and final report for each run.
7. Offer a constrained subset of Playwright MCP's generic browser tools. We do
   not expose arbitrary JavaScript execution or file upload.
8. Restrict direct navigation to the target origin and require scenario-level
   authorization before accepting a final-submission dialog.

We intentionally implement the model/tool loop ourselves instead of delegating
it to a general agent SDK. The loop is small, important to the assignment, and
must be easy for reviewers to inspect and for us to defend.

## Why Playwright MCP

Playwright MCP exposes browser interaction through structured accessibility
snapshots and standard MCP tools. It supports isolated sessions, headless or
headed execution, saved session output, and origin filtering. Running the
server from the repository's pinned package version makes the discovery setup
visible and repeatable.

Sources:

- [Microsoft Playwright MCP repository](https://github.com/microsoft/playwright-mcp)
- [Playwright MCP getting-started documentation](https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md)
- [MCP TypeScript client documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md)

## Why Claude Opus 5 for initial discovery

Our initial model choice favors tool-use reliability and unfamiliar UI
reasoning over cost. Anthropic reports that Opus 5 leads its computer-use
evaluation on OSWorld 2.0 at the stated operating cost. The public OSWorld 2.0
leaderboard remains useful independent context, although newly announced model
results can appear in provider reports before the public table is updated.
OpenRouter confirms that its Opus 5 route accepts images and tool calls.

This evidence supports Opus 5 as our first discovery model; it does not prove
that Opus 5 is the best production choice for every task or price point.

Sources:

- [Anthropic: Claude Opus 5 announcement](https://www.anthropic.com/news/claude-opus-5)
- [OSWorld 2.0 public leaderboard](https://osworld-v2.xlang.ai/)
- [OpenRouter: Claude Opus 5](https://openrouter.ai/anthropic/claude-opus-5)
- [OpenRouter tool-calling documentation](https://openrouter.ai/docs/guides/features/tool-calling)
- [OpenRouter reasoning configuration](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

## Consequences

Benefits:

- Reviewers can run the same browser server, scenarios, and loop from code.
- Atomic and chained trajectories can be compared directly.
- A fresh profile prevents one scenario's cookies from silently affecting
  another.
- Model choice is a configuration value rather than an architectural lock-in.
- The recorded tool subset gives us evidence for the next-stage actuator API.

Trade-offs:

- Opus 5 costs more than candidate production models.
- Accessibility snapshots may miss visual-only information; screenshots remain
  available as evidence or a fallback.
- Playwright MCP is an exploration dependency, not automatically the final
  deterministic replay architecture.
- Origin filtering is defense in depth, not a complete security boundary, so
  the runner also validates direct navigation itself.

## Revisit when

We will revisit this decision after the atomic and chained runs. At that point
we should know the used action set, where snapshots were insufficient, and
whether a cheaper model reaches the same outcomes with comparable reliability.

## First-run observation

On 2026-09-12, the configured Opus 5 route accepted a simple browser-navigation
request but refused atomic task A1 before making a tool call. Its refusal said
the fictional member-lookup task triggered Anthropic's cyber-content filter.
The same harness and task then completed successfully with configurable model
`moonshotai/kimi-k2.6`.

This does not erase the reasoning behind the initial choice; it is new runtime
evidence that may change it. We are retaining both trajectories and will decide
whether to replace the default after reviewing this first result.
