---
name: reflect
description: Turn a failure that just happened into a constitution rule, or decide it was a one-off. Proposes changes; never commits them.
---

# Reflect

Something went wrong. Decide whether it was a one-off or class-shaped, and if it
is class-shaped, propose the rule that stops it recurring.

This is the ratchet. Without it the same mistake ships twice.

## Process

1. **State the failure concretely.** What broke, how it was noticed, and what it
   would have cost if it had not been. Vague failures produce vague rules.

2. **Ask whether it is class-shaped.** Be honest — most failures are not.

   | Signal | Reading |
   | --- | --- |
   | It could recur in a file nobody has written yet | Class-shaped |
   | It passed every existing check | Class-shaped |
   | It was invisible in the normal workflow | Class-shaped |
   | It was a typo, or specific to one line | One-off — stop here, just fix it |

   A one-off gets fixed and forgotten. Adding a rule for it costs context on
   every future task and protects against nothing (`[HC-REAL-MISTAKES-ONLY]`).

3. **Check whether an existing bar already covers it.** Read
   `docs/methodology/CONSTITUTION.md`. If a bar covers it, the failure is that
   the bar was not followed or not checked — which is a `coverage-gaps.md`
   update, not a new rule.

4. **Draft the rule** as bar / pattern / verification with a stable slug:

   ```markdown
   ### `[HC-<NAME>]`

   - **Bar**: the one-line normative statement
   - **Pattern**: how it is satisfied in this codebase
   - **Verification**: the test that catches it, or "manual"
   ```

   Prefer a real check. If the honest answer is "manual", say so — an
   overstated verification is worse than an admitted gap.

5. **Update `coverage-gaps.md`** in the same proposal. Every bar appears there
   with its real status.

6. **Propose. Do not commit.** Present the failure, the draft rule, and the
   coverage entry, and let a human approve (`[HC-PROPOSE-NEVER-COMMIT]`).

7. **Sweep** once approved: find existing code that already crosses the new bar.
   A rule that only applies to future code leaves the original defect in place
   elsewhere.

## Note

The constitution is short on purpose — 31 rules, each traceable to a real defect
or an explicit product decision. Every addition makes the others slightly less
likely to be read. The bar for adding one is high, and "no rule needed" is a
good outcome.
