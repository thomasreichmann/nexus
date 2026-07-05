---
name: work
description: Work on a GitHub issue (implement, test, commit, PR)
argument-hint: <issue-number>
disable-model-invocation: true
---

# Work on Issue

Implement a GitHub issue: research, implement, review, commit, PR.

**Git state:**
!`git status --short; git branch --show-current; git log --oneline -5`

**Issue number:** $ARGUMENTS

## Workflow

1. **Understand.** `gh issue view <n> --json number,title,body,labels,milestone`. Briefly summarize description, acceptance criteria, and out-of-scope.

2. **Branch.** `git fetch origin main`, then `git checkout -b <type>/<n>-<slug> origin/main` (types: feat/fix/refactor/docs/chore). If the branch already exists, ask: resume it, rebase onto `origin/main`, or use a different name.

3. **Research.** Read `docs/ai/conventions.md`. Spawn an `explore-issue` agent to find related files, patterns, and similar implementations. Decide files to change, patterns to follow, and change order.

4. **Implement.** Stay within acceptance criteria; note out-of-scope discoveries as follow-up issues rather than expanding scope (if scope must grow, ask first). Repeat until green: `pnpm check`. UI changes also require `pnpm -F web test:e2e:smoke`; new pages need a smoke test in `apps/web/e2e/smoke/` following `home.spec.ts`. DB schema changes: see CLAUDE.md for `db:generate`/`db:migrate`/`db:custom`. If checks, tests, or migrations fail, show the output and ask: fix now / continue (note in PR) / abort with changes uncommitted.

5. **Verify criteria.** Walk each acceptance criterion and confirm it's satisfied (run relevant tests). If one isn't met, ask whether to address now or note for follow-up.

6. **Self-review (never skip).** Spawn 3 parallel Task agents, each given the changed files and diff: `conventions-review`, `code-quality-review`, `reuse-review`. Present findings grouped by category and ask: fix all / fix selected / skip (note in PR). Apply approved fixes, re-run `pnpm check`.

7. **Commit & push.** Invoke the `/commit` skill (runs on a cheap model in a forked context). Message format: `<type>: <description> (#<n>)`. Stage only related files.

8. **PR.** `gh pr create` with body:

    ```
    ## Summary
    <what was done and why>

    Closes #<n>

    ## Changes
    - <change>

    ## Test Plan
    - [ ] <how to verify>
    ```
