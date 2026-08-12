---
name: self-review
description: Run the work skill's self-review phase standalone — a review workflow (conventions, code quality, reuse) over the current branch diff
argument-hint: [issue-number]
---

# Self-Review

Review the current diff via the `self-review` workflow (three specialized reviewers in parallel). This is step 6 of the `/work` skill, runnable standalone.

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

3. **Run the review workflow.** Invoke the `Workflow` tool with the saved workflow (falls back to `scriptPath: .claude/workflows/self-review.js` if name lookup fails):

    ```
    Workflow({
      name: 'self-review',
      args: {
        diffPath: '<scratchpad>/diff.txt',
        changedFiles: [...],          // real JSON array, not a string
        criteria: '<criteria text>',  // omit if none
      }
    })
    ```

    It runs the three reviewers (`conventions-review`, `code-quality-review`, `reuse-review`) in parallel with structured output, then an aggregate stage merges duplicate findings across reviewers; the diff travels by **path** only, never inlined into args. The call returns immediately — wait for the completion notification, don't poll.

4. **Triage.** The workflow returns `{ findings, notes, failedReviewers, aggregated }`. Each finding carries `reviewers`: every reviewer that independently reported it. That count is the strongest quality signal — findings come pre-sorted by it, and 2+ reviewers means treat it as near-certainly real; surface that count when presenting. If `findings` is empty, report clean and stop (mention `failedReviewers` if any reviewer died; if `aggregated` is false the dedup pass failed and findings are unmerged singletons). Otherwise present findings in order, each with its reviewer count and category, and ask: fix all / fix selected / skip. Apply approved fixes, then re-run `pnpm check` (skip the re-run if no fixes were applied).
