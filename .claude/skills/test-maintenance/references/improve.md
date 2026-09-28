# Improve, then prove it

## Before the first edit

- **An issue owns the work.** Use the open issue that already covers the
  area, or draft one from the approved plan (the body format is in
  `docs/ai/github-workflow.md`) and create it once the user approves.
- **A branch** from `origin/main`: `git checkout -b test/<n>-<slug> --no-track origin/main`.
- **The before measurement is saved** (`$S/before-*.json`). Nothing gets
  compared against a number measured after you started editing.

## One item at a time

For each approved item:

1. **Write the test at the level the verdict names**, following "Writing a
   test" in `docs/conventions/testing.md`. SQL goes on the integration tier:
   `*.integration.test.ts` next to the code, `it` from
   `@nexus/db/test-db/integration` (`db`, `user`, `createUser`), rows from
   the typed insert helpers in `@nexus/db/test-db`. Copy
   `packages/db/src/repositories/uploadBatches.integration.test.ts`.
2. **Run it green** on its tier: `pnpm -F <pkg> test:run <file>` for a unit
   test, `pnpm -F <pkg> test:integration <file>` (dev DB) or
   `pnpm test:integration:fresh --filter=<pkg>` (throwaway Postgres) for an
   integration test.
3. **Break the behaviour by hand.** Apply the survivor it targets
   (`original → replacement` at its line) or drop the `WHERE` term, flip the
   `<`, delete the call. Watch the test go red, then undo the break with
   Edit. Record "broke X → Y went red" for the PR.
4. **Replacing a test?** Delete the old one only after the new one kills
   every mutant the old one killed. The "lost protection" check below shows
   it.

## Playbook

| Finding                                                         | Fix                                                                                                                               | Break that proves it                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| SQL tested on a fake or mocked DB, or a `where → {}` survivor   | Integration test that seeds the row the predicate must exclude (another user's, a deleted one, a lapsed one)                      | Drop the `WHERE` term                       |
| Boundary survivor (`>` → `>=`, a cap, a clamp)                  | A case exactly at the edge, and one on each side                                                                                  | Flip the operator                           |
| Passes without the code (a copy, never imported, never reached) | Import the real thing, assert an effect only it can produce                                                                       | Delete the call or the mapping              |
| Mystery guest (a default elsewhere decides it)                  | Set every precondition in the test, so the named one is the only reason                                                           | Change the default the test used to lean on |
| Obscure test (the title claims more than the asserts)           | Assert what the title says (`rejects.toMatchObject({ … })`), or rename it                                                         | Change the detail the title names           |
| A controller unit-tested through mocks of its repositories      | Integration test on the real DB, stubbing only what leaves the process (S3, SQS, Stripe, PostHog)                                 | Break the repository call's predicate       |
| Overcomplicated code (decisions tangled with I/O)               | Extract the decision into a pure function and unit-test its edges. If that's more than a small refactor, propose an issue instead | Flip a branch in the extracted function     |
| Mutants no test runs (`noCoverageLines`) on risky code          | A test at the lowest level where the break is visible                                                                             | Any mutant on those lines                   |
| Equivalent survivor (no caller could notice)                    | No test. If it keeps coming back: `// Stryker disable next-line <Mutator>: <reason>`                                              | None: say why in the report                 |
| Unsure whether anyone would notice                              | No test yet. List it as a finding for the user                                                                                    | —                                           |

## Validate

- `pnpm check`.
- `pnpm test:integration:fresh` when an integration test changed. It's what
  CI's required `Integration tests` check looks like.
- `pnpm -F web test:e2e:smoke` if a page or component changed (check
  `pgrep -fa playwright` first: the dev DB is shared).

## Before and after

Measure the same file set again:

```bash
pnpm --silent mutate --only <area> --json > $S/after-mutation.json
pnpm --silent cov:touched --only <area> --json > $S/after-coverage.json
```

Totals, for each of before and after:

```bash
jq -r '"\(.score)% (\(.killed)/\(.total)), \(.coveredScore)% of the mutants a test runs"' $S/before-mutation.json
jq -r '[.files[] | select(.lines)] | "lines \(map(.lines.covered) | add)/\(map(.lines.total) | add), branches \(map(.branches.covered) | add)/\(map(.branches.total) | add)"' $S/before-coverage.json
```

**Lost protection**: survivors after that weren't survivors before. Keyed
without line numbers, since edits move lines. This must be empty. If it
isn't, fix it before reporting:

```bash
jq -n --slurpfile b $S/before-mutation.json --slurpfile a $S/after-mutation.json '
  def keys($r): [$r.files[] | .path as $p | .survivors[]? | "\($p) \(.mutator) \(.original) → \(.replacement)"];
  keys($a[0]) - keys($b[0])'
```

Report to the user:

| `<area>`                        | Before          | After          |
| ------------------------------- | --------------- | -------------- |
| Mutation score                  | 70.4% (330/469) | …              |
| Of the mutants a test runs      | 81.7%           | …              |
| Lines covered                   | 151/223         | …              |
| Branches covered                | …               | …              |
| Survivors                       | 23              | … (all judged) |
| Grades of the tests you changed | C, D, D         | A, B, A        |

Then:

- **Closed:** each survivor now killed, and the test that kills it.
- **Left:** each remaining survivor, and why (equivalent, unsure, out of
  scope with its issue).
- **Broken by hand:** the list from step 3.

No test-count row. The table says how much more of the area's behaviour
would now go red when broken, and that's the result.

Then offer the commit (`test: <what the area's tests now catch> (#<n>)`)
and the PR. Its body carries the table, the closed and left survivors, and
the breaks, with `Closes #<n>`. Follow the repo's usual PR flow from there
(`pnpm check`, CI green, `/self-review`).
