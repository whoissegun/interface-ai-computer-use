# Discovery-to-artifact compilation - 2026-09-15

## Result

The deterministic compiler consumed the retained genuine Kimi discovery run
`2026-09-12T04-42-43-561Z-a1-3ba9b18a` and emitted a schema-valid
`northstar.find-member@1.0.0` capability.

The generated files are attached directly to the source run:

- [`capability.json`](./2026-09-12T04-42-43-561Z-a1-3ba9b18a/capability.json)
- [`artifact-compilation.json`](./2026-09-12T04-42-43-561Z-a1-3ba9b18a/artifact-compilation.json)

The report identifies four compiled business actions and five ignored
observation/wait calls. It confirms that temporary Playwright targets and the
sample member value were not persisted.

## Deterministic replay of the generated artifact

The generated artifact was then passed directly to the replay CLI with member
number `100042`. Replay used no LLM, completed all four generated steps in
2.361 seconds, and returned the expected member number, displayed name, and
active status.

The complete replay evidence is in
[`2026-09-15T04-31-02-208Z-northstar-find-member-f34fe78c`](../replay/2026-09-15T04-31-02-208Z-northstar-find-member-f34fe78c/).

This demonstrates the executable chain:

```text
genuine LLM discovery
  -> recorded structured trajectory
  -> validated generated capability
  -> deterministic replay without an LLM
```
