---
name: self-review
description: Run the work skill's self-review phase standalone — 3 parallel review agents (conventions, code quality, reuse) over the current branch diff
argument-hint: [issue-number]
---

# Self-Review

Review the current diff with 3 parallel specialized agents. This is step 6 of the `/work` skill, runnable standalone.

**Git state:**
!`git status --short; git branch --show-current`

**Issue number (optional):** $ARGUMENTS

## Steps

1. **Build the diff.** Write it once to a scratch file without echoing it into context. If the working tree is dirty, include uncommitted changes:

    ```bash
    git fetch origin main
    # dirty tree: includes uncommitted work
    git diff origin/main > <scratchpad>/diff.txt
    # clean tree: committed work only
    git diff origin/main...HEAD > <scratchpad>/diff.txt
    ```

    Also capture the changed-file list (`git diff --name-only` with the same base). If the diff is empty, say so and stop.

2. **Acceptance criteria (optional).** If an issue number was passed, `gh issue view <n> --json title,body` and extract the acceptance criteria. Otherwise `code-quality-review` runs without criteria — note that in its prompt so it reviews for general quality only.

3. **Spawn reviewers.** Spawn 3 parallel Task agents — `conventions-review`, `code-quality-review`, `reuse-review` — each given the diff file **path** and the changed-file list (`code-quality-review` also gets the acceptance criteria if available); do not inline the diff or file contents into spawn prompts.

4. **Triage.** Present findings grouped by category and ask: fix all / fix selected / skip. Apply approved fixes, then re-run `pnpm check` (skip the re-run if no fixes were applied).
