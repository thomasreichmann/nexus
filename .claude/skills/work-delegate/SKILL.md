---
name: work-delegate
description: Work on a GitHub issue as a delegator — explore via agent, implement via a delegated executor agent (implement, test, commit, PR)
argument-hint: <issue-number>
disable-model-invocation: true
---

# Work on Issue (Delegated)

Implement a GitHub issue as a delegator: you orchestrate and judge; an explore agent maps the code and an executor agent reads and writes it. You do not read repo files yourself beyond the issue and the docs listed below — judge reports and plans against the issue, not against the repo.

**Gated spawns (applies to both agents below).** Spawn each agent with a minimal prompt: identify its role and instruct it to reply "ready" and stop, using no tools. Deliver the real task as the first SendMessage continue. Rationale: spawn-form and resume-form system prompts differ, so an agent's first continue always breaks the prompt cache; gating pays that break at ~0 context and makes every later continue (follow-ups, phase B, fix rounds) a cache hit. Cache TTL is 1h across the board, so pauses for delegator judgment or user questions under an hour don't lose the prefix. Always continue the same agent via SendMessage — never respawn (respawning loses its context and re-bills the reading).

**Git state:**
!`git status --short; git branch --show-current; git log --oneline -5`

**Issue number:** $ARGUMENTS

## Workflow

1. **Understand.** `gh issue view <n> --json number,title,body,labels,milestone`. Briefly summarize description, acceptance criteria, and out-of-scope.

2. **Branch.** `git fetch origin main`, then `git checkout -b <type>/<n>-<slug> origin/main` (types: feat/fix/refactor/docs/chore). If the branch already exists, ask: resume it, rebase onto `origin/main`, or use a different name.

3. **Research.** Read `docs/ai/conventions.md`. Spawn an `explore-issue` agent (gated), then continue it with the issue body and this required report format — an **evidence pack**, not a list of pointers:
    - **Evidence per acceptance criterion** — for each criterion: the files involved, and VERBATIM quoted snippets (with file paths) of everything the executor must rely on: the code to be changed, patterns to mimic, type signatures verified, test helpers and their defaults. Quote the relevant lines, don't cite file:line alone. The executor will implement from these quotes without re-verifying them.
    - **Change map** — files that need modification, why, in suggested order.
    - **Declared skips** — what it deliberately didn't look at and why that's safe.
    - **Open questions** — ambiguities in the issue or contradictions in the code.

    Judge the report on paper — do not open the files it cites. Check: every criterion has quoted evidence attached; the change map covers every criterion; declared skips aren't load-bearing for any criterion; open questions are answerable from the issue text. If a check fails, continue the explorer with a targeted follow-up. Resolve open questions you can't answer from the issue with the user NOW — never park a live executor on a user question later if it can be settled here.

4. **Implement (delegated, two-phase).** Spawn one `general-purpose` executor agent, gated, with no model override — it inherits the session model. Continue it with the full briefing: the issue body and acceptance criteria, the complete evidence pack, the conventions doc path, the check commands below, and these reading rules: _read only the files in the change map (you need their full content to edit them) plus the conventions doc; trust the pack's quoted evidence — do not re-read mimic files or node_modules types; flag anything you read that contradicts the pack._

    **Phase A — verify & plan.** The briefing instructs the executor to return an implementation plan — files to change, what changes in each, test approach — plus a **report discrepancies** section. No code yet. If the map and territory diverge badly, it must return `blocked:` with specifics instead of a plan.

    Review the plan against the issue: every criterion addressed, no invented scope, discrepancies resolved or escalated to the user. If the plan has holes, continue the executor with ALL revisions in one message. If it returned blocked, decide from the specifics: follow up with the explorer, answer from the issue, or ask the user.

    **Phase B — implement.** On approval, continue the executor: implement. Its instructions: stay within acceptance criteria; report out-of-scope discoveries back rather than expanding scope; repeat until green: `pnpm check`. UI changes also require `pnpm -F web test:e2e:smoke`; new pages need a smoke test in `apps/web/e2e/smoke/` following `home.spec.ts`. DB schema changes: see CLAUDE.md for `db:generate`/`db:migrate`/`db:custom`. It returns: summary of changes per file, test/check output, and any deviations from the approved plan with reasons. If checks, tests, or migrations fail and the executor can't fix them, show the output and ask the user: fix now (continue the executor) / continue (note in PR) / abort with changes uncommitted.

5. **Verify criteria.** Walk each acceptance criterion against the executor's change summary and test output, and re-run relevant tests yourself to confirm. If one isn't met, ask whether to send the executor back now or note for follow-up.

6. **Self-review (never skip).** Spawn 3 parallel Task agents, each given the changed files and diff: `conventions-review`, `code-quality-review`, `reuse-review`. Present findings grouped by category and ask: fix all / fix selected / skip (note in PR). Continue the executor with ALL approved fixes in one message (it has the implementation context; its continues are cheap), then re-run `pnpm check`.

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
