---
name: cap
description: Quickly commit and push the current task's changes directly to origin/main. Invoke explicitly with /cap.
---

# Commit and Push to Main

Use this skill for rapid iteration: commit the current task's changes and push
them directly to `origin/main` with minimal overhead.

## Safety rules

- Work only in the current repository and worktree.
- Never force-push, amend, reset, or discard changes.
- Never commit secrets or files unrelated to the current task.
- Do not run tests, lint, type-checks, builds, fetches, or ancestry checks unless
  the user explicitly asks for them.
- Never deploy, release, or publish (e.g. `vercel deploy`). Committing and pushing
  is where this skill ends — production deploys are a separate, explicit step via
  the `/deploy` skill. A push to `main` does not require a prod redeploy.

## Process

1. Inspect `git status --short` and a concise diff summary.
2. If there are no changes to commit, report that and stop.
3. Identify the files belonging to the completed task. Leave unrelated changes
   unstaged.
4. Stage the task files using explicit paths, then run only these fast checks:

   ```bash
   git diff --cached --stat
   git diff --cached --check
   ```

5. Write a concise commit using the repository convention:

   ```text
   [area] Short description

   Optional explanation of the meaningful behavior change.

   Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>
   ```

6. Push immediately with a normal, non-force push:

   ```bash
   git push origin HEAD:main
   ```

7. Confirm the pushed commit and report the result concisely. If the remote
   rejects the push, report the rejection without automatically rebasing,
   merging, or force-pushing.
