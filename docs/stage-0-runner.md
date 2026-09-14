# Stage 0 Runner

The Stage 0 runner connects an OpenRouter model to the official Playwright MCP
server. It records an inspectable browser trajectory for one scenario at a
time. It does not yet create a reusable capability or perform deterministic
replay.

## Setup

Requirements:

- Node.js 20 or newer
- Google Chrome
- an OpenRouter API key with access to the configured model

Install the pinned dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env
```

Replace the example `OPENROUTER_API_KEY` value in `.env`. The real `.env` is
ignored by Git.

## See available scenarios

```bash
npm run stage0 -- --list
```

## Run one scenario

The first atomic task runs by default:

```bash
npm run stage0 -- --scenario a1
```

Use `--headed` to watch the browser:

```bash
npm run stage0 -- --scenario a1 --headed
```

Override the model without changing code:

```bash
npm run stage0 -- --scenario a1 --model moonshotai/kimi-k2.6
```

Other useful controls are `--reasoning-effort`, `--max-steps`, `--max-tokens`,
and `--target-url`.

## Evidence layout

Every execution creates a unique directory under `evidence/stage0/`:

```text
evidence/stage0/<timestamp>-<scenario>-<id>/
├── run.json
├── offered-tools.json
├── events.ndjson
├── summary.json
├── playwright-mcp.stderr.log
├── tool-*.png                  # when an image-producing tool is used
└── playwright/                 # Playwright MCP session artifacts
```

`events.ndjson` is the ordered trajectory. `summary.json` is the quick result,
including the used-tool counts, token use, cost when reported, and elapsed
time. The runner redacts the configured API key from evidence and logs.

## Safety boundaries

- Playwright uses a fresh isolated browser context for every run.
- Direct navigation is restricted to the configured target origin.
- Arbitrary JavaScript evaluation and file upload are not offered to the
  model.
- Only scenario `a4` authorizes accepting the fake final-submission dialog.
- Tool calls are capped, and each run has a model-response timeout.
- The target app contains only fictional training data and simulated writes.

## Verification

```bash
npm run typecheck
npm test
```

The unit tests use fake model and browser clients. They do not spend OpenRouter
credits or launch Chrome.
