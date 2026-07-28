# Copilot instructions

Read [`AGENTS.md`](../AGENTS.md) first. It is the router for this repository and
carries the read order, the path-to-rule table, the commands, and the must-not
list.

The canon is [`docs/methodology/CONSTITUTION.md`](../docs/methodology/CONSTITUTION.md).
It supersedes this file (`[HC-CANON-PRECEDENCE]`).

**This repository is in prototype mode** (section 0 of the canon). It is a
single-author app that is not yet usable end to end, so gates costing minutes
are suspended: adversarial review and `npm run package && npm run smoke` are on
demand, and the loop's BEFORE-evidence step is required for bug fixes only.
`./scripts/verify.sh` takes 2.7 seconds and is never skipped. The privacy bars
are never suspended either — they cost nothing to keep and protect things that
cannot be repaired after the fact.

This file deliberately contains no rules of its own. Two loaders holding two
copies of the same guidance is how they drift apart (`[HC-ROUTE-DONT-ROOT]`).
