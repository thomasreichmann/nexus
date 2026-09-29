# Grading a test

The definitions (the four pillars, the quadrants, the smells, which level)
are in `docs/conventions/testing.md` § "Writing a test". Read that first.
This file adds what a grade needs: the 1–5 scale for each pillar, the grade
bands, and how to weigh the grade against the mutation result. It is the
rubric of the 2026-09-28 audit (148 tests, 101 mutation-checked), so grades
stay comparable with that baseline.

## Scores, 1–5 per pillar

Be calibrated, not generous. Read the code under test as well as the test.

**Protection against regressions.** How much real logic does it run, and
would a plausible bug in it turn the test red?

| Score | Looks like                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| 5     | Runs domain logic or a SQL predicate and pins its edge: the boundary value itself, the row the `WHERE` must exclude |
| 4     | Real logic, main path and some edges; a boundary or a secondary effect is left unpinned                             |
| 3     | Real logic, but it asserts only part of the outcome (the error class, not its details), or the logic is thin        |
| 2     | Trivial code, or asserts that a plausible bug wouldn't break (checks the recipient, not the body)                   |
| 1     | Can't fail for the behaviour it names: a tautology, a copy of the code, a mock that returns the expected value      |

**Resistance to refactoring.** Would a correct rewrite keep it green?

| Score | Looks like                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 5     | Asserts only outcomes: the return value, the thrown error, the DB rows, the response, what the user sees      |
| 4     | Outcomes, with a little coupling (an exact error message)                                                     |
| 3     | Outcomes plus an assertion on a mock of our own code                                                          |
| 2     | Mostly asserts calls on mocks of our own code, call order, or exact log copy                                  |
| 1     | Asserts the Drizzle chain's `values()`/`set()`/`where()` or generated SQL text: any correct rewrite breaks it |

Stubbing what leaves the process (S3, SQS, Stripe, PostHog, the network) is
not coupling. Don't mark it down.

**Fast feedback:** pure unit 5, jsdom or component render 4, integration on
real Postgres 3, a short Playwright check 2, a multi-minute flow 1.

**Maintainability:** 5 when arrange → act → assert fits on one screen with
typed fixtures; 3 with notable setup or shared state; 1 when it's flaky or
hard to follow (sleeps, sequenced stubs, a serial chain of shared users).

**Value** = the product of the four (max 625). **Grade:** A ≥ 300, B ≥ 150,
C ≥ 60, D < 60.

**Quadrant** is the code under test's, not the test's: domain, controller,
trivial or overcomplicated (the table in testing.md).

**Smells:** use the names in testing.md's table. List only the ones present.

**Hygiene** (FIRST): note a failing letter only when it's real: shared
mutable state between tests (I), uncontrolled time, randomness or sleeps
(R), no assertion (S). FIRST is a checklist, not a score: 98% of the
audit's unit tests passed it, weak ones included.

## Mutation is the ground truth

Each test's tally (`tests[]` in the `pnpm mutate --json` slice) says how
many of the file's mutants it ran and how many turned it red. The survivors
it ran are in `survivors[]` with `coveredBy`. Use them this way:

- **The tally is not a grade.** A test that pins one behaviour of a big file
  kills few of the mutants it runs, and that's fine. What matters is whether
  it kills the mutants on **the behaviour its title names**.
- **Judge a test on the files its title is about.** Tests elsewhere run a
  file incidentally: a worker test that builds a repository over a mocked
  `db` runs the repository's code and asserts nothing about it. Their
  `killed: 0` on that file is expected, and says nothing about them.
- **Covered only incidentally is untested.** A file that no test of its own
  runs still reads as covered when other layers pass through it. Its
  survivors are behaviour nobody pins. In the 2026-09-28 survey,
  `repositories/retrievalRequests.ts` had no repository test, and 42 of its
  103 mutants survived under the worker and service tests that ran it.
- **`ran > 0, killed: 0` on its own subject** is a test that runs the code
  and notices nothing there. Find out why: a mock decides the outcome, or it
  asserts something else. Its regression score is at most 2.
- **A survivor on the named behaviour** caps regression at 3, however good
  the test looks. On the audit, 18 tests graded A/B still let boundary
  mutants survive (`>` → `>=` in preflight, the quota soft cap).
- **`timedOut`** mutants count as killed in the file's score, but no test is
  named. On a busy machine, real kills can time out. Grade those tests from
  the code, and don't read `ran: 0` as "untested".
- **Mutation is ground truth, not the whole truth.** `pnpm mutate` empties
  a whole `where`, drops each term of a drizzle `and(...)` / `or(...)` and
  each builder `.where(...)` (`DrizzleCondition`, #524), but never removes a
  `limit`, an `orderBy` or a `set` field. For those, look for the rows that
  would show the difference. If there aren't any, it's a gap: break it by
  hand to confirm. The 2026-09-28 dry run found five gaps by hand (an id
  term next to an ownership term, a bystander row for a single-row update,
  a `limit` that never bites); `DrizzleCondition` now finds the first two
  kinds.
- **The regression pillar predicts mutation best.** Correlation with each
  test's kill ratio on the audit: regression pillar 0.65, the value product
  0.46, smell count 0.36, refactor 0.18, FIRST 0.12, quadrant 0.07. When the
  grade and the mutation result disagree, trust the mutation result for
  protection and the grade for maintenance cost.

The two ways they disagree, and what each means:

| Static grade | Mutation                   | Reading                                          | Fix                                                                                                          |
| ------------ | -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A/B          | survivors on its behaviour | It pins the main path, not the edge              | Add the boundary case or the excluded row. Keep the test                                                     |
| C/D          | kills everything it runs   | Sensitive but brittle: coupled to mocks, or slow | Keep its protection. Move it to the right level or assert on outcomes, then check the same mutants still die |

Kill rates by grade on the audit: A 80%, B 84%, C 52%, D 22%. Repository
tests on the fake DB: 36%, every survivor a dropped or altered `WHERE`.

## Verdict per test

One of:

- **keep**: it pins its behaviour and its survivors are equivalent.
- **pin the edge**: add the boundary or excluded-row case a survivor points at.
- **tighten**: assert what the title claims (obscure test, partial outcome).
- **move level**: its behaviour lives in SQL, or in a pure function, or in
  what the user sees. Name the level and the test that carries it.
- **decouple**: replace assertions on how the result was produced with
  assertions on the result.
- **rewrite**: it passes without the code (a copy, a mock that decides, never
  reaches the subject). Say what it must import and which effect only the
  real code produces.

Every verdict other than keep names the regression it would catch and the
mutant (line, `original → replacement`) that proves it.

## Output: one record per test

```json
{
    "file": "packages/db/src/repositories/files.integration.test.ts",
    "name": "exact test title, with its describe path",
    "level": "unit | integration | e2e",
    "regression": 4,
    "refactor": 5,
    "speed": 3,
    "maintain": 4,
    "value": 240,
    "grade": "B",
    "quadrant": "domain | controller | trivial | overcomplicated",
    "smells": ["Mystery guest"],
    "hygiene": [],
    "mutation": { "ran": 12, "killed": 9, "timedOut": 0 },
    "survivorsOnItsBehaviour": [
        "L298 gte(files.createdAt, createdAfter) → true"
    ],
    "verdict": "pin the edge",
    "fix": "Seed a file created one second before createdAfter and assert it is excluded",
    "note": "under 20 words: the one thing a reader should know"
}
```

`mutation` is null when the test ran none of the measured files' mutants.
Double-check that `value` is the product and `grade` follows the bands.
