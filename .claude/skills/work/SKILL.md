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

1. **Spawn & summarize.** The issue is pre-fetched above — don't re-fetch it. (If the pre-fetch shows an error instead of an issue, run `gh issue view <n> --json number,title,body,labels` yourself before anything else.) In one block: spawn the `explore-issue` agent in the background with its full task — the issue body plus the report format from step 3 — and run `ToolSearch select:SendMessage` (needed for explorer follow-ups in step 3) and `git fetch origin main`. For a large issue — many acceptance criteria spanning layers (db/backend/frontend/infra) — spawn 2–3 explorers in that block instead, each scoped to a layer or criteria cluster (full issue body plus its slice); they run concurrently, so the longest slice governs. Single-component issues keep one explorer. Briefly summarize description, acceptance criteria, and out-of-scope.

2. **Fill the research window.** The explorer takes minutes; use them:
    - `git checkout -b <type>/<n>-<slug> --no-track origin/main` (type from the labels: feat/fix/refactor/docs/chore) — if the branch already exists, ask: resume it, rebase onto `origin/main`, or use a different name. **`--no-track` matters:** without it, branching off a remote-tracking ref sets the new branch's upstream to `origin/main`, and a bare `git push` then dies with `fatal: The upstream branch of your current branch does not match the name of your current branch` — safe under the default `push.default=simple`, but confusing, and it becomes an actual push-to-`main` hazard if `push.default` is ever set to `upstream` or `matching`. With `--no-track` there is no upstream at all, so a bare `git push` just creates the correctly-named remote branch.
    - Right after branching, start `pnpm check` as a background task: it warms the fresh worktree's cold cache and proves the baseline green, so any later red is attributable to your change. If the explorer's report arrives before it finishes, wait for it before editing any file — a mid-run edit poisons the check.
    - Read `docs/ai/conventions.md`.
    - Read the files the issue body explicitly cites — only those. Broader reading duplicates the explorer's job and bloats context the evidence pack exists to save.
    - Fetch the parent/linked issues the body references (`gh issue view <m> --json title,body`) — context for judging the report in step 3 and for filing follow-ups at the end.

3. **Judge the research.** The explorer's report must be an **evidence pack**, not a list of pointers:
    - **Evidence per acceptance criterion** — for each criterion: the files involved, plus VERBATIM quoted snippets (with file paths) from files that will **not** be edited — patterns to mimic, type signatures verified, test helpers and their defaults. Quotes are the load-bearing lines only — a signature plus the lines relied on, not whole functions; pack length is serial output time. Implement from these quotes without re-reading their source files. For change-map files, path + line range + one line on what's there is enough; those get read in full before editing anyway.
    - **Change map** — files that need modification, why, in suggested order.
    - **Declared skips** — what it deliberately didn't look at and why that's safe.
    - **Open questions** — ambiguities in the issue or contradictions in the code.

    Judge the report before implementing. Check: every criterion has evidence attached; the change map covers every criterion; declared skips aren't load-bearing for any criterion; open questions are answerable from the issue text. With multiple explorers, judge the union of their packs and pay extra attention to the seams — interfaces between slices are where scoped explorers go blind. If a check fails, continue the owning explorer via SendMessage with a targeted follow-up — never respawn (respawning loses its context and re-bills the reading). Resolve open questions you can't answer from the issue with the user NOW — never hit a user question mid-implementation if it can be settled here.

4. **Implement.** Read only the files in the change map — for large files, read the region the pack's line ranges point at rather than the whole file — and trust the pack's quoted evidence for everything else; flag anything you read that contradicts the pack. Stay within acceptance criteria; note out-of-scope discoveries as follow-up issues rather than expanding scope (if scope must grow, ask first). Repeat until green: `pnpm check`. UI changes also require `pnpm -F web test:e2e:smoke`; new pages need a smoke test in `apps/web/e2e/smoke/` following `home.spec.ts`. DB schema changes: see CLAUDE.md for `db:generate`/`db:migrate`/`db:custom`. If checks, tests, or migrations fail, show the output and ask: fix now / continue (note in PR) / abort with changes uncommitted.

5. **Verify criteria.** Walk each acceptance criterion and confirm it's satisfied, citing step 4's run results; execute something new only for criteria not covered by `pnpm check` or the smoke suite (e.g. a manual flow or a migration). If one isn't met, ask whether to address now or note for follow-up.

6. **Self-review (never skip).** Invoke the `/self-review` skill with the issue number so `code-quality-review` gets the acceptance criteria. Skipped findings get noted in the PR.

7. **Commit & push.** Invoke the `/commit` skill (runs on a cheap model in a forked context). Message format: `<type>: <description> (#<n>)`. Stage only related files, and push with `git push -u origin <branch>` — name the branch explicitly, never rely on a configured upstream.

8. **PR.** `gh pr create` with body:

    ```
    ## Summary
    <what was done and why>

    Closes #<n>

    ## Changes
    - <change>

    ## Test Plan
    - [x] <verification you performed>
    - [ ] <step you tried to verify but couldn't — note what you tried>
    ```

    The Test Plan records verification, it's not a to-do for the reader. If an item hasn't run yet, run it now — a UI flow via Playwright spec, DB state via `db:query`, an endpoint via `curl` — then check it. Leave a box unchecked only after an automation attempt failed or none exists (visual judgment, prod-only access), and say which in its note.
