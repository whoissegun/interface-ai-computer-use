# Capability artifacts

Files in this directory are versioned, reviewable contracts for deterministic
computer-use replay. They contain parameters and placeholders, not values from
individual runs or raw model transcripts.

`schema.v1.json` is the serialization schema. The TypeScript definitions and
runtime checks live under `src/replay/`. A capability version is immutable once
approved; a contract or flow change creates a new semantic version.

The four checked-in capabilities cover the target's core operations:

| Artifact | Purpose | Risk level |
| --- | --- | --- |
| `northstar.find-member.v1.json` | Find and verify a member | Read only |
| `northstar.read-balance.v1.json` | Open one account under that member and return balances | Read only |
| `northstar.prepare-subaccount.v1.json` | Prepare a draft and stop at verified review | Reversible write |
| `northstar.simulate-subaccount.v1.json` | Verify review, then run the fictional final simulation | Simulated irreversible; explicit confirmation required |

Each artifact is compiled from the three successful discovery trajectories
named in its `provenance` block. Locators describe stable accessibility
relationships. Runtime Playwright refs are deliberately absent because they
change between browser sessions.

The executor validates each artifact against `schema.v1.json` and then checks
cross-field rules: action allowlists, input-choice coverage, assertion
references, and the confirmation/dialog sequence for the final simulation.
