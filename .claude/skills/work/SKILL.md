---
name: work
description: Work on a GitHub issue (implement, test, commit, PR)
argument-hint: <issue-number>
disable-model-invocation: true
---

# Work on Issue

Implement a GitHub issue: research, implement, review, commit, PR.

**Git state:**
!`git status --short; git branch --show-current`

**Issue number:** $ARGUMENTS

**Issue (pre-fetched):**
!`gh issue view $(printf '%s' "$ARGUMENTS" | sed 's/^#//') --json number,title,labels,body --template '#{{.number}} — {{.title}}{{"\n"}}labels: {{range .labels}}{{.name}}, {{end}}{{"\n\n"}}{{.body}}'`

## Workflow

1. **Spawn & summarize.** The issue is pre-fetched above — don't re-fetch it. (If the pre-fetch shows an error instead of an issue, run `gh issue view <n> --json number,title,body,labels` yourself before anything else.) In one block: spawn the `explore-issue` agent in the background with its full task — the issue body plus the report format from step 3 — and run `ToolSearch select:SendMessage` (needed for explorer follow-ups in step 3) and `git fetch origin main`. Briefly summarize description, acceptance criteria, and out-of-scope.

2. **Branch while it researches.** `git checkout -b <type>/<n>-<slug> origin/main` (type from the labels: feat/fix/refactor/docs/chore) — if the branch already exists, ask: resume it, rebase onto `origin/main`, or use a different name — and read `docs/ai/conventions.md`.

3. **Judge the research.** The explorer's report must be an **evidence pack**, not a list of pointers:
    - **Evidence per acceptance criterion** — for each criterion: the files involved, plus VERBATIM quoted snippets (with file paths) from files that will **not** be edited — patterns to mimic, type signatures verified, test helpers and their defaults. Implement from these quotes without re-reading their source files. For change-map files, path + line range + one line on what's there is enough; those get read in full before editing anyway.
    - **Change map** — files that need modification, why, in suggested order.
    - **Declared skips** — what it deliberately didn't look at and why that's safe.
    - **Open questions** — ambiguities in the issue or contradictions in the code.

    Judge the report before implementing. Check: every criterion has evidence attached; the change map covers every criterion; declared skips aren't load-bearing for any criterion; open questions are answerable from the issue text. If a check fails, continue the explorer via SendMessage with a targeted follow-up — never respawn (respawning loses its context and re-bills the reading). Resolve open questions you can't answer from the issue with the user NOW — never hit a user question mid-implementation if it can be settled here.

4. **Implement.** Read only the files in the change map — for large files, read the region the pack's line ranges point at rather than the whole file — and trust the pack's quoted evidence for everything else; flag anything you read that contradicts the pack. Stay within acceptance criteria; note out-of-scope discoveries as follow-up issues rather than expanding scope (if scope must grow, ask first). Repeat until green: `pnpm check`. UI changes also require `pnpm -F web test:e2e:smoke`; new pages need a smoke test in `apps/web/e2e/smoke/` following `home.spec.ts`. DB schema changes: see CLAUDE.md for `db:generate`/`db:migrate`/`db:custom`. If checks, tests, or migrations fail, show the output and ask: fix now / continue (note in PR) / abort with changes uncommitted.

5. **Verify criteria.** Walk each acceptance criterion and confirm it's satisfied, citing step 4's run results; execute something new only for criteria not covered by `pnpm check` or the smoke suite (e.g. a manual flow or a migration). If one isn't met, ask whether to address now or note for follow-up.

6. **Self-review (never skip).** Invoke the `/self-review` skill with the issue number so `code-quality-review` gets the acceptance criteria. Skipped findings get noted in the PR.

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
