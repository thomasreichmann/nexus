---
name: test-maintenance
description: Improve the protection of one area of the test suite, together with the user. Survey the suite (risk map, coverage, mutation), agree on a focus area, grade its tests (Khorikov's pillars, mutation as ground truth), strengthen them, and prove it with a before/after mutation score
argument-hint: '[area you have in mind] (optional; the survey still comes first)'
disable-model-invocation: true
---

# Test Maintenance

A focused pass that raises how much protection one area's tests give. The
user decides where. The tools and the grading say what is weak, and the
mutation score proves the result.

**The goal is protection, never a test count.** Talk about the regressions a
test would miss and the mutants that now die. Never set, suggest or report a
target number of tests. If the count changes, that's a side effect: don't
headline it.

**Git state:**
!`git status --short; git branch --show-current`

**Coverage maps from:** !`date -r coverage/coverage-final.json '+%F %R' 2>/dev/null || echo "none yet: run pnpm coverage"`

**Open test-quality issues (sub-issues of epic #502):**
!`gh api repos/{owner}/{repo}/issues/502/sub_issues --jq '.[] | select(.state=="open") | "#\(.number) \(.title)"' 2>/dev/null || echo "(could not fetch)"`

**Area the user has in mind:** $ARGUMENTS

## Rules

- **Read first:** the "Writing a test" section of `docs/conventions/testing.md`.
  It defines the levels, the no-fake-DB rule, the four pillars, the quadrants
  and the smells. This skill applies them and never restates them.
- **The user picks the area.** Never choose one unprompted, not even the one
  passed as an argument, until the user has seen the survey. The conversation
  stays in this main thread: subagents do analysis only and never ask the
  user anything. If the user can't answer, stop after the survey.
- **Read tool output as JSON** (`pnpm --silent <cmd> --json > file`, then
  `jq`). Never parse the human-formatted tables.
- **Never lose protection.** A test is rewritten or replaced only when the
  new version kills every mutant the old one killed.
- Scratch files go in the session scratchpad (`$S` below).

## Phases

### 1. Survey the suite

Load `references/survey.md` and follow it: the churn × coverage map rolled up
by area, then a scoped mutation run and a small graded sample for 3–5
candidate areas. Present the state and the candidates, then ask the user what
they care about right now and which area to take. Wait for the answer.

### 2. Assess the chosen area

1. Take the **before** measurement over the area's source files and keep it:

    ```bash
    pnpm --silent mutate --only <area> --json > $S/before-mutation.json
    pnpm --silent cov:touched --only <area> --json > $S/before-coverage.json
    ```

2. Grade every test **of** the area: the test files next to its sources,
   and tests elsewhere whose title is about its code. Tests that only run it
   on the way to something else (their `tests[].file` is in another layer)
   are context, not subjects. Dispatch `test-grader` subagents in parallel,
   one per test file, as `references/survey.md` § "Dispatching graders"
   describes. Reuse the survey's grades.
3. Triage every survivor with the "Reading survivors" rules in
   `docs/conventions/testing.md`: gap, equivalent or unsure.
4. Present the per-test table (pillars, grade, smells, quadrant, mutation
   tally), the survivors, and a numbered plan: each item names the
   regression it closes and the mutant it will kill. Mark items an open
   issue or PR already owns (`gh issue list --search "<file>"`, `gh pr list`)
   as theirs, not yours. Ask which items to do.

`references/grading.md` holds the rubric and how to read a grade against the
mutation result.

### 3. Improve

Load `references/improve.md`. Work through the approved items one at a time.
Each one ends with the behaviour broken by hand, the test red, and the break
reverted.

### 4. Prove it

Measure again with the same commands (to `after-*.json`). Report the
before/after table from `references/improve.md` § "Before and after", list
the survivors left and why, and offer the commit and PR.
