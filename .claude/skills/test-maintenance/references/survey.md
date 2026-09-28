# Survey: the suite's state, and where to focus

Goal: show the user where the suite protects least, with evidence, and let
them choose. Coverage says which code no test runs. Only mutation says
whether the tests that do run it would notice a break. Show both.

## 1. The map

The map is built from the per-tier coverage maps of the last `pnpm coverage`.
If the timestamp in the skill header is older than today or than the last
merge you pulled, refresh it first: `pnpm coverage` (about 40 s; the
integration tiers need `DATABASE_URL`, and without it `packages/db` reads
low).

```bash
pnpm --silent cov:touched --all --json > $S/map.json
```

Every source file, with `status`, `lines`, `branches`, `churn` (commits in
90 days), `risk` (churn × uncovered share) and `mutation` (a cached
`pnpm mutate` result, or null). The schema is in `docs/conventions/testing.md`
§ "After coding: `pnpm cov:touched`".

**Workspace totals:**

```bash
jq -r '[.files[] | select(.status != "no-code")
  | {ws: (.path | if startswith("packages/db") then "packages/db" elif startswith("apps/worker") then "worker" else "web" end),
     c: .lines.covered, t: .lines.total}]
  | group_by(.ws) | .[]
  | "\(.[0].ws)\t\((map(.c) | add) * 1000 / (map(.t) | add) | round / 10)%\t\(map(.c) | add)/\(map(.t) | add)"' $S/map.json
```

**By area** (a directory), riskiest first. `bare` counts files no unit or
integration test runs (`untested` or `e2e-only`):

```bash
jq -r '[.files[] | select(.status != "no-code")
  | . + {area: (.path | split("/") | .[:-1] | join("/"))}]
  | group_by(.area)
  | map({area: .[0].area, files: length,
         covered: (map(.lines.covered) | add), total: (map(.lines.total) | add),
         churn: (map(.churn) | add), risk: (map(.risk) | add),
         bare: (map(select(.status == "untested" or .status == "e2e-only")) | length),
         mut: ([.[].mutation | select(. != null and .total > 0)]
               | if length == 0 then "—" else "\((map(.killed) | add) * 100 / (map(.total) | add) | round)%" end)})
  | sort_by(-.risk) | .[:20][]
  | "\(.risk * 10 | round / 10)\t\(.churn)\t\(.covered)/\(.total)\t\(.bare)/\(.files) bare\tmut \(.mut)\t\(.area)"' \
  $S/map.json | column -t -s $'\t'
```

**Covered but unproven:** well-covered areas that change often. The risk
score ranks them low because their lines run, but that says nothing about
whether the tests would notice a break. Swap the last two lines of the query
above for:

```bash
  | map(select(.total > 0 and .covered / .total >= 0.6)) | sort_by(-.churn) | .[:10][]
  | "\(.churn)\t\(.covered)/\(.total)\tmut \(.mut)\t\(.area)"' $S/map.json | column -t -s $'\t'
```

## 2. Candidates (3–5)

Mix three kinds, so the user sees different trade-offs:

- **The top of the risk rollup**: changed most, tested least.
- **Covered but unproven**: high churn with good coverage. Mutation decides
  whether the coverage is real protection.
- **What the user named** (the skill argument) and areas the open issues in
  the header point at.

Leave out test infrastructure (`packages/db/src/test-db`, `seed`, `e2e/`),
`scripts/`, and `components/ui` (vendored primitives).

**Check what's in flight.** An area whose tests an open issue or PR is
already rewriting (the header's issues, `gh pr list --state open --json
number,title,files`) is listed as "in flight (#N)", not offered as a
candidate. Two people rewriting the same tests wastes both.

For an area that is mostly `e2e-only` (components, pages, tRPC routers),
say what improving it takes. Usually that's extracting the decisions into a
pure function to unit-test (the overcomplicated quadrant), or an integration
test for a router. That's a bigger change than tightening assertions.

## 3. Sample each candidate

**Mutation.** One run over all the candidates. Per candidate, take the 2–3
highest-churn source files that some test runs (`status` `partial` or
`covered`). Start it in the background:

```bash
pnpm --silent mutate --only <files…> --json > $S/survey-mutation.json
```

Expect minutes. Integration-covered files and big services cost the most
(the timing table is in `docs/conventions/testing.md` § "Mutation testing").
On 2026-09-28, 9 files (1,273 mutants, `subscriptions.ts` alone 317) took
10 minutes on a machine busy with other runs. So keep the survey to a few
files per candidate: mutating a whole area is phase 2's job. Build the map
and the table while it runs. Stryker instruments the files in place, so edit
nothing under them until it's done.

**Graded sample.** About 6 tests per candidate:

1. every test of the area whose tally is `killed: 0` on the file it's
   about (it runs the code and notices nothing). Tests from other layers
   that only run the file incidentally don't count here,
2. the tests that ran a survivor (`survivors[].coveredBy`),
3. then a spread over the remaining test files: happy path, error path,
   edge. Don't cherry-pick good or bad ones.

Dispatch one grader per candidate, in parallel (next section).

## Dispatching graders

Give each grader only its slice of the mutation JSON: the tests of one test
file, by its repo path (`tests[].file`; basenames repeat across packages),
and the survivors those tests ran:

```bash
jq --arg t 'packages/db/src/repositories/files.integration.test.ts' '{files: [.files[] | select(.tested)
  | [.tests[] | select(.file == $t)] as $mine
  | {path, score, killed, total, tests: $mine,
     survivors: [.survivors[] | select(any(.coveredBy[]; IN($mine[].test)))]}
  | select(($mine | length) > 0)]}' $S/before-mutation.json > $S/slice-files-int.json
```

Then, in one block, one `Agent` call per slice:

```
Agent({
  subagent_type: 'test-grader',
  description: 'Grade <test file>',
  prompt: `Test file: <path>
Tests: all | only these titles: <…>
Code under test: <source paths>
Mutation slice: <$S/slice-….json>
Return the JSON array described in your instructions.`,
})
```

Save each returned array to `$S/grades-<area>.json`. The grader reads
`references/grading.md` itself.

## 4. Present, then ask

Keep it to one screen:

1. **State in one line:** total and per-workspace line coverage, and the
   mutation score of what was sampled.
2. **The area table:** area, risk, churn, lines covered, mutation score
   (sampled), sample grades (e.g. `2A 3B 1C`), and the weakest finding in
   protection terms: "dropping the ownership filter in X goes unnoticed",
   not "3 bad tests".
3. **In flight:** areas owned by open issues or PRs.
4. **Candidates**, your lean first. Each gets one line on what could break
   unnoticed today, and one on what improving it involves (level, rough
   size).

Then ask, with `AskUserQuestion` from the main thread: what do they care
about right now (a feature about to change, a recent incident, an area they
distrust), and which area to take. Offer the candidates as options. The
free-text answer covers anything else. Wait for the answer. Don't start
phase 2 on your own lean.
