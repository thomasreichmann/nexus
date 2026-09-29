---
title: Testing
created: 2026-03-07
updated: 2026-09-28
status: active
tags:
    - conventions
    - testing
aliases:
    - Testing Guide
---

# Testing

**Before you write or review a test, read [Writing a test](#writing-a-test).**
It covers which test to write and how to tell whether it protects anything.
The rest of this page is reference for each tier:
[Integration](#integration-tests-real-database),
[Unit](#unit-tests), [Smoke](#smoke-tests-for-pages) and
[E2E](#authenticated-e2e-tests),
[Coverage](#code-coverage), [`pnpm cov:touched`](#after-coding-pnpm-covtouched)
and [`pnpm mutate`](#mutation-testing-pnpm-mutate).

## Writing a test

A test earns its place when breaking the behaviour it names turns it red.
Everything below serves that one rule.

### The workflow

1. **Write the code.**
2. **Run `pnpm cov:touched`**
   ([reference](#after-coding-pnpm-covtouched)). It lists the files you
   changed, worst-covered first. `untested` and `e2e-only` lines are where to
   look first.
3. **Decide what each uncovered behaviour needs:** which
   [quadrant](#code-quadrants-where-a-test-pays-off) the code is in, and
   which [level](#which-level) would see it break.
4. **Write the test.** Assert on outcomes, keep it clear of the
   [smells](#smells), and check it against the [four pillars](#the-four-pillars).
5. **Break the behaviour, then watch the test go red.** Flip the `<`, drop
   the `WHERE` term, delete the call, then revert. If the test stays green,
   it isn't testing that behaviour, so fix the test. Say what you broke in the
   PR.
6. **Run `pnpm mutate`** ([reference](#mutation-testing-pnpm-mutate)) on
   your changed files. It makes step 5 systematic: every small break
   (`>` → `>=`, a `where` → `{}`, a condition → `true`) that no test
   notices is listed with its line. Each survivor is a missing test, an
   assertion that needs tightening, or a change no one could notice
   ([how to read them](#mutation-testing-pnpm-mutate)).

Coverage shows which code no test runs. Only step 5 (and mutation testing)
shows whether a test that runs the code would notice it breaking. On the
2026-09-28 audit, tests graded A and B still let boundary mutants survive
(`>` → `>=` in `lib/upload/preflight.ts`, the quota soft cap) because nobody
pinned the edge.

### Which level

Pick the **lowest level at which the bug would be visible.**

| Where the correctness lives                                                                           | Level                                                                                   | Example in this repo                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logic with no I/O: rules, calculations, parsing, status derivation                                    | **Unit**                                                                                | `packages/db/src/plans.test.ts` pins `isTrialExpired` _exactly at_ `trialEnd`, plus each status that must never expire                                                                                      |
| SQL: `WHERE` predicates, ownership scoping, upserts, `ON CONFLICT`, unique indexes, concurrent writes | **Integration** ([real DB](#integration-tests-real-database))                           | `packages/db/src/repositories/retrievals.integration.test.ts` "active queries exclude lapsed rows…" seeds every row of the predicate's truth table, plus another user's row, and asserts the exact set back |
| A service, route or handler coordinating several collaborators                                        | **Integration**, stubbing only what leaves the process (S3, SQS, Stripe, PostHog)       | `files.integration.test.ts` "lands the same usage as serial confirms when fired concurrently" (a mocked chain cannot race)                                                                                  |
| A route or service branch decided by its inputs, not by SQL                                           | **Unit**, asserting the response or thrown error                                        | `apps/web/app/api/health/route.test.ts` "returns 503 when the DB query throws"                                                                                                                              |
| What a user sees and does: pages, auth guards, multi-step flows, client ↔ tRPC ↔ DB wiring            | **E2E** (smoke, flows, admin). See [[../guides/e2e-testing-guidelines\|E2E guidelines]] | `apps/web/e2e/admin/jobs.spec.ts`: guards, filtering, pagination, retry                                                                                                                                     |

- A dropped `WHERE` term is invisible to a unit test. The mock returns what
  you told it to, whatever the query says. SQL correctness is always
  integration.
- For a presentational component, smoke and e2e cover the rendering. Unit
  test the logic you pull out of it: `file-browser/status.ts`,
  `subscriptionPlans.ts`.

### The no-fake-DB rule

**Repository and query code is never tested against a mocked or fake DB.**
That means `createMockDb`, a `vi.mock` of the connection, or assertions on
the `values()`/`set()`/`where()` a mocked Drizzle chain received. The mock
ignores the query, so it can only prove the builder was called. On the
audit, fake-DB repository tests killed 4 of 11 mutants (36%), and every
survivor changed which rows a query touches, ownership filters included
(#489). The rule covers query-building code wherever it lives, including a
service that calls Drizzle directly.

Test it on the [integration tier](#integration-tests-real-database), with the
`@nexus/db/test-db/integration` fixtures. Lint enforces the rule under
`packages/db/src` (#496).

Mocking your own **non-DB** code is fine: a service's repositories, a
logger, a transport. The audit found it isn't what makes a test weak
(68% of mutants killed with it, 70% without). Judge those tests by the
pillars.

### The four pillars

Khorikov's pillars are the yardstick authors and reviewers share. A test's
value is roughly their product: a test that scores zero on any one of them
is worth nothing.

| Pillar                             | Ask                                                                                         | A low score here                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Protection against regressions** | If I broke the behaviour this test names, would it go red? How much real logic does it run? | `server/services/files.test.ts` "throws NotFoundError when file belongs to different user": the fake DB returns nothing for any query, so ownership is never exercised |
| **Resistance to refactoring**      | Would it stay green through a correct rewrite of the implementation?                        | Asserting call counts on `onConflictDoNothing`, a mocked `.set()` payload, or a logger's exact message                                                                 |
| **Fast feedback**                  | How long does it take to go red?                                                            | Unit ≪ integration ≪ e2e. `upload-queue.spec.ts`'s 400 MB multipart test takes about a minute                                                                          |
| **Maintainability**                | Can a reader see arrange → act → assert on one screen? How much setup is there?             | `worker/src/pollRetrievals.test.ts` "partitions a ready request…" needs three sequenced `returning` stubs                                                              |

- **Regression protection comes first.** On the audit it was the best single
  predictor of whether a test caught mutants (r = 0.65, against 0.46 for the
  combined score).
- **Don't trade away resistance to refactoring.** Assert on what the code
  returns, throws, writes to the DB, or shows the user, not on how it got
  there. A test that fails on every correct refactor gets muted in the end.
- **Trade speed for protection by picking the level**, not by asserting less.
- FIRST (fast, isolated, repeatable, self-validating, timely) is a hygiene
  checklist, not a quality score: 98% of unit tests pass it, weak ones
  included.

### Code quadrants: where a test pays off

Place the code on two axes: how complex or domain-significant it is, and how
many collaborators it talks to.

| Quadrant                                               | Here                                                                                            | How it gets its protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain and algorithms** (complex, few collaborators) | `lib/upload/*`, `packages/db/src/plans.ts`, `worker/src/partition.ts`, `file-browser/status.ts` | Unit tests, edges included. This is where a test buys the most protection                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Controllers** (simple, many collaborators)           | tRPC routers, services that orchestrate repositories + S3/SQS, API routes, worker handlers      | Integration tests over the real DB, and e2e for the user path. Don't unit-test a controller by asserting which mocks it called in which order                                                                                                                                                                                                                                                                                                                                                           |
| **Trivial** (simple, few collaborators)                | Pass-throughs, constants, re-exports, field mappers                                             | The tests of the code that uses it. A dedicated test rarely catches anything those don't, so put the effort there                                                                                                                                                                                                                                                                                                                                                                                       |
| **Overcomplicated** (complex, many collaborators)      | `worker/src/pollRetrievals.ts`, the request flow in `server/services/retrieval.ts`              | Extract the decisions into pure functions and unit-test those, leaving a thin controller for the integration tier. `lib/upload/preflight.ts` is that shape: the upload flow calls it, and it has no I/O. When the decisions are the orchestration itself, move it out of the framework and take the collaborators as arguments: `useUpload` binds `lib/upload/queue.ts` to React, and its tests run it against an in-memory backend (`lib/upload/testing.ts`) that refuses what the server would (#501) |

A repository method with a `WHERE` clause is not trivial: the predicate is
the logic, and it belongs on the integration tier.

### Smells

| Smell                              | How to spot it                                                                | Here                                                                                                                                                                                                   | Instead                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Passes without the code** (#490) | The subject is re-implemented in the test, never imported, or never reached   | `server/trpc/middleware/errorHandler.test.ts` tests a copy of the middleware. `logger/__tests__/mapping.test.ts` never imports `mapping.ts`. `worker/src/handler.test.ts` never checks the handler ran | Import the real thing and assert on an effect only it can produce                           |
| **Mockery**                        | Most of the test sets up mocks, and the asserts check what the mocks received | `packages/db/src/repositories/files.test.ts` "returns soft-deleted files for user" checks only the `set()` payload, so dropping the user scope survived                                                | Integration test that seeds the row the query must exclude                                  |
| **Tautological assertion**         | The assertion holds whatever the code does                                    | `repositories/files.test.ts` "returns only files that exist and are owned by user": the mock returns the one row the test expects                                                                      | Make the input able to produce the wrong answer, then assert on the right one               |
| **Obscure test**                   | The title claims more than the asserts check                                  | `server/services/quota.test.ts` "throws QuotaExceededError with details…" checks only the error class                                                                                                  | Assert what the title says (`rejects.toMatchObject({ details })`), or rename it             |
| **Mystery guest**                  | The outcome depends on a default set somewhere else                           | `retrieval.integration.test.ts` "getDownloadUrl rejects a lapsed ready retrieval" passes because the S3 mock defaults to archived; the lapsed row is irrelevant                                        | Set every precondition in the test, so the named one is the only reason for the outcome     |
| **Sensitive equality**             | It compares serialized output: SQL text, `toString`, full copy                | `repositories/invites.test.ts` "gates on the same expiry boundary…" substring-matches the generated SQL                                                                                                | Assert on the behaviour: rows either side of the boundary, on the real DB                   |
| **Assertion roulette**             | Many unlabelled asserts, and a failure doesn't say which behaviour broke      | `repositories/storage-usage.test.ts` "upserts and returns the new snapshot": none of its asserts reach the increment                                                                                   | One behaviour per test, with the assert that proves it                                      |
| **Conditional test logic**         | An `if`, loop or `try` decides what gets asserted                             | The `try { …; expect.fail() } catch { expect(…) }` blocks in `errorHandler.test.ts`                                                                                                                    | `await expect(p).rejects.toMatchObject({ … })`. `it.each` for tables                        |
| **Eager test**                     | One test checks several unrelated behaviours                                  | `e2e/flows/files-browser.spec.ts` "standard-tier file without a retrieval…" checks status, menu items and estimate copy together                                                                       | Split it. Push the derivation down to a unit test (`file-browser/status.test.ts`)           |
| **Excessive setup**                | Arrange dwarfs act and assert                                                 | `pollRetrievals.test.ts` "partitions a ready request…"                                                                                                                                                 | Extract the decision (overcomplicated quadrant). For DB state, use the typed insert helpers |

Several of these examples are queued for repair (#489, #490). Once one is
fixed, its git history still shows the smell.

### Improving tests that already exist

`/test-maintenance` applies this section to an area of the existing suite.
It maps churn × coverage with you, and you pick the area. It then grades that
area's tests against a mutation run, strengthens them, and reports the
before/after mutation score.

## Smoke Tests for Pages

Every new page should have a corresponding E2E smoke test in `apps/web/e2e/smoke/`. These tests verify that pages render without console errors, catching:

- Hydration mismatches from SSR/client differences
- Missing `nativeButton={false}` on Base UI components with non-button `render` props
- Broken imports or missing dependencies
- React warnings from invalid prop usage

**Pattern:**

```typescript
// e2e/smoke/feature.spec.ts
import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test('feature page renders without console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);

    await page.goto('/feature');

    // Verify key elements are present
    await expect(page.getByRole('heading', { name: 'Feature' })).toBeVisible();

    // Check for console errors after render
    expect(errors).toEqual([]);
});
```

The `setupConsoleErrorTracking` helper lives in `e2e/utils.ts` and is shared across all test files.

## Authenticated Smoke Tests

For pages that require authentication (dashboards, admin pages), use the `authenticated` fixture instead of writing bare smoke tests. Tests live in `e2e/smoke/authenticated/` and run under the same `smoke` Playwright project (which depends on `setup` for auth state).

**Fixture:** `e2e/fixtures/authenticated.ts`

| Option          | Type                | Default  | Purpose                                                                   |
| --------------- | ------------------- | -------- | ------------------------------------------------------------------------- |
| `userRole`      | `'admin' \| 'user'` | `'user'` | Selects auth state (`ADMIN_STATE_PATH` or `USER_STATE_PATH`)              |
| `consoleErrors` | `string[]`          | (auto)   | Collects console errors — assert with `expect(consoleErrors).toEqual([])` |

**Pattern:**

```typescript
// e2e/smoke/authenticated/feature.spec.ts
import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'admin' });

test.describe('Admin Feature', () => {
    test('feature page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/admin/feature');
        await expect(
            page.getByRole('heading', { name: /feature/i })
        ).toBeVisible();
        expect(consoleErrors).toEqual([]);
    });
});
```

**Where to place tests:**

- `e2e/smoke/` — public pages (landing, sign-in, sign-up, dev tools)
- `e2e/smoke/authenticated/` — any page behind authentication (dashboard, admin, settings)

## Authenticated E2E Tests

For pages requiring auth (e.g. admin dashboards), use the `storageState` pattern with a Playwright setup project. Reusable helpers live in `e2e/helpers/`:

| Helper                      | Purpose                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `e2e/helpers/auth.ts`       | `createUser`/`promoteToAdmin`/`authenticateAndSaveState` (BetterAuth API) + `provisionDedicatedUser` |
| `e2e/helpers/connection.ts` | `createTestDb()` — a typed connection for code outside the fixture chain (`global.setup.ts`)         |
| `e2e/helpers/scenarios.ts`  | E2E-specific multi-row seeders over the typed helpers (`seedJobs`/`seedFiles` + cleanup)             |
| `e2e/helpers/trpc.ts`       | Batch-safe tRPC request matching: `interceptTrpcCalls` (record + abort), `waitForTrpcRequest`        |

### Test data: factories, fixtures, scenarios (back-door setup)

Establish every precondition the fastest correct way — through the DB or API — and
drive **only the behavior under test** through the UI (Cypress calls this "App
Actions"). Three layers, all built on `@nexus/db/test-db` (a typed,
connection-injectable, vitest-free surface that resolves cleanly under
Playwright):

1. **Factories** — pure row builders shared with unit tests
   (`createFileFixture`, `createUserFixture`, …), re-exported from
   `@nexus/db/test-db`. The single source of column defaults.
2. **Inserts / queries / scenarios** — `insertFile`/`insertUploadBatch`/…,
   `findUserByEmail`/`deleteUserData`/`markSubscriptionPaid`/…, and multi-step
   `readyRetrieval`/`paidSubscription`. Each takes a `db` connection; identity
   and uniqueness (`id`/`s3Key`/`stripeCustomerId`) are minted in the insert
   layer so the factories keep their stable `TEST_*` ids for unit assertions.
3. **Playwright fixtures** (`e2e/fixtures/`) — composable preconditions with
   teardown, extending the `console → authenticated → db → dedicated-user → data`
   chain. Import `{ test, expect }` from `e2e/fixtures` to get the whole chain:
    - `db` (worker-scoped connection), `seedUserId` (the user precondition
      fixtures seed for — the shared user by `userRole`, or a dedicated user).
    - `dedicatedUserConfig` option + `dedicatedUser` fixture: set
      `test.use({ dedicatedUserConfig: { user, statePath } })` **at file top level**
      (never in a describe — it's a worker-scoped option) to provision a dedicated
      per-spec user once per worker; `storageState` then auth's the page as it.
      The email and path are base names: the fixture scopes both to the run and
      worker, so no other run or worker can reset or delete that user.
    - `seededBatch` / `seededFile` / `readyRetrieval` / `paidSubscription` — yield
      the entity and clean up after the test.

    ```typescript
    import { test, expect } from '../fixtures';
    test.use({ dedicatedUserConfig: { user: MY_USER, statePath: STATE_PATH } });
    test('download works', async ({ page, readyRetrieval }) => {
        /* ... */
    });
    ```

    For a precondition a single insert can't express, or seeded state shared
    across a serial describe, define a spec-local worker fixture over the `db`
    fixture (see `flows/files-browser.spec.ts`'s `seededLibrary`). Prefer a
    dedicated user for any empty-state or exact-count assertion; shared-user data
    specs must run `serial`.

**Asserting on tRPC traffic:** never match procedure URLs with substrings or
hand-rolled regexes — `httpBatchLink` can merge same-tick calls into
`/api/trpc/<a>,<b>?batch=1`, which breaks both. Use `e2e/helpers/trpc.ts`,
which matches the procedure as a full path segment.

**Auth setup runs as a Playwright project** (`global.setup.ts`), not `globalSetup` config — because `globalSetup` runs before `webServer` starts, making API calls impossible.

**Adding a new test suite:** Create `e2e/admin/your-feature.spec.ts` — the `admin` project auto-matches all files under `admin/`. Auth `storageState` is applied automatically; no per-test login needed. For seed data, reach for the typed helpers in `@nexus/db/test-db` via the `db` fixture (or a precondition fixture); add multi-row e2e seeders to `e2e/helpers/scenarios.ts` (see `seedJobs`/`cleanupJobs` as the reference implementation).

**Pattern:**

```typescript
// e2e/admin/feature.spec.ts
import { test, expect } from '@playwright/test';

// Serial execution when tests share seeded data
test.describe.configure({ mode: 'serial' });

test.describe('feature with seeded data', () => {
    // Seed in beforeAll, cleanup in afterAll
    // Use domain-specific helpers from e2e/helpers/seed.ts

    test('displays data correctly', async ({ page }) => {
        await page.goto('/dashboard/admin/feature');
        // storageState is auto-applied by the "admin" project config
        // ...assertions
    });
});
```

**Playwright config** projects:

- `setup` — Signs up this run's admin and regular users (emails scoped by `E2E_RUN_ID`, see `e2e/helpers/run-id.ts`), saves their auth state under `e2e/.auth/run-<id>/`, and sweeps users left by killed runs. Its `teardown` project deletes the run's users when every dependent project is done, so overlapping runs on the shared dev DB never share a user (#484)
- `smoke` — All smoke tests (public + authenticated, depends on `setup`, matches `smoke/`)
- `admin-files` → `admin-jobs` → `admin` — Admin specs share the admin user's data (and the global jobs table), so the spec files are **chained as dependent projects**: serialization is enforced in the config itself, for every entrypoint (`playwright test`, `--ui`, all scripts). New admin specs land in the catch-all `admin` tail; if it ever holds more than one file, give the new file its own chain link.
- `flows` — Interactive user flows (matches `flows/`). Each spec opts into a **dedicated user** with `test.use({ dedicatedUserConfig: { user, statePath } })` (the worker-scoped `dedicatedUser` fixture provisions it once and tears it down), so empty-state and exact-count assertions can't race other specs.
- `validate` — Destructive dev-environment validation. **Env-gated** (`E2E_VALIDATE=1`): it doesn't exist in normal runs, so a plain `playwright test` can never run it alongside smoke and corrupt the shared user's data. Run via `pnpm -F web test:e2e:validate`.

## E2E Coverage (100% target)

`e2e/coverage/manifest.ts` lists every page and user-facing use-case — it is
the definition of 100% E2E coverage. Tests declare what they cover with
Playwright tags:

```typescript
test(
    'search filters files',
    { tag: ['@page:/dashboard/files', '@uc:files-search'] },
    async ({ page }) => { ... }
);
```

- `pnpm -F web e2e:coverage` — regenerates `coverage/e2e-coverage.json` and prints a summary; `--check` exits 1 below 100% (also fails on tags that don't match the manifest, on app routes missing from the manifest — the `PAGES` list is cross-checked against `app/**/page.tsx` — and on use-cases covered only by the manual `validate` tier without a `manual` acknowledgment)
- `/dev/coverage` — dashboard showing E2E (pages + use-cases per area, exclusions with reasons) and unit coverage

**When you ship a new page or user-facing flow:** add it to the manifest
first, then write the tagged test. Use-cases that can't be E2E-tested get an
`excluded` reason in the manifest instead of being silently dropped — never a
placeholder test with no assertions, which would mark the use-case "covered"
while verifying nothing. Use-cases verified only by the manual `validate`
tier (not run in CI) must carry a `manual` reason so that's a visible,
deliberate decision.

**Every spec must be importable with no env.** The gate lists tests with
`E2E_VALIDATE=1 E2E_REPRO=1` so the manual tiers count toward coverage, and
listing imports every spec file — in CI, with no `.env.local` and no
credentials. Reading env or building a client (`createTestS3()`, a db
connection) belongs in a fixture or a `beforeAll`, never at module scope: a
top-level throw takes down the whole listing, so the gate fails with no
coverage numbers at all rather than with one broken spec. Living in
`validate/` or `repro/` is not an exemption — those tiers never _run_ in CI,
but they are always _listed_.

**Key gotchas:**

- Back-door seeding goes through `@nexus/db/test-db` (typed, connection-injectable) — `createDb(url)` resolves and queries the dev DB cleanly under Playwright. Do not drop to a raw `postgres` driver or hand-written SQL; the typed insert helpers fill ids/`s3Key` so there's no manual `gen_random_uuid()`. (`@nexus/db/testing` is the unit-test surface and pulls `vitest`, so it must not be imported from e2e — that's why `test-db` is a separate, vitest-free entrypoint.)
- BetterAuth API calls require an `Origin` header for CSRF
- BetterAuth sign-in/up (not `insertUser`) is the only way to make a user that can authenticate through the UI — `insertUser` writes the bare `user` row, no password/account
- React Query retries failed requests 3x (~7s) — use `{ timeout: 15_000 }` for auth guard tests
- Use `test.describe.configure({ mode: 'serial' })` when tests share seeded DB data; mutations that invalidate a query while its initial fetch is still in flight should `cancelQueries` + `refetchQueries` (not just `invalidateQueries`), or the stale result wins

## Integration Tests (real database)

Repository and query code is tested against a real Postgres, never a mocked
or fake DB. A mock of the Drizzle chain returns whatever the test told it to,
so it can't see a dropped `WHERE` condition, a wrong `ON CONFLICT` or a
broken index. Those are the bugs these tests exist for (#489). The same tier
holds service tests whose point is SQL behaviour: atomic upserts, status
claims under concurrency, unique indexes.

**Where they live:** `*.integration.test.ts`, next to the code under test.

| Code under test                                 | Home                                       | Command                                  |
| ----------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| A repository or query (`packages/db/src/...`)   | `packages/db/src/**/x.integration.test.ts` | `pnpm -F @nexus/db test:integration`     |
| A service whose behaviour is SQL (`apps/web/…`) | `apps/web/**/x.integration.test.ts`        | `pnpm -F @nexus/web test:integration`    |
| A worker job or its handling (`apps/worker/…`)  | `apps/worker/src/**/x.integration.test.ts` | `pnpm -F @nexus/worker test:integration` |
| Every package                                   |                                            | `pnpm test:integration`                  |

For a job handler, `apps/worker/src/handlers/generateThumbnail.integration.test.ts`
is the example: each outcome is read back from the row it writes, with S3
faked at the client's `send` and ffmpeg/ffprobe/exiftool at `execFile`.

The fakes can't judge the tools' command lines, so
`generateThumbnail.toolchain.integration.test.ts` runs the same handler
against the real binaries from the Lambda layers, on small fixtures in
`handlers/__fixtures__/` (#523). The `Thumbnail toolchain` workflow runs it
(not a required check). Without the binaries it skips with a notice, and
with `THUMBNAIL_TOOLCHAIN_REQUIRED=1` it fails instead. To run it locally,
unzip the layers to `/opt` the way Lambda mounts them. Take the zips from
the `ffmpeg-layer` and `exiftool-layer` artifacts of the latest `Lambda Layers`
run on main (`gh run download <run-id> -n ffmpeg-layer -n exiftool-layer -D dist/layers`),
or build them with docker (`docker run --rm -v "$PWD:/src" -w /src amazonlinux:2023 bash tooling/lambda-layers/build-ffmpeg-layer.sh dist/layers`,
and the same for `build-exiftool-layer.sh`). Then:

```bash
for zip in dist/layers/*.zip; do sudo unzip -q -o "$zip" -d /opt; done
PATH=/opt/bin:$PATH LD_LIBRARY_PATH=/opt/lib pnpm -F @nexus/worker test:integration generateThumbnail.toolchain
```

`pnpm mutate` judges the argv only when run with that same `PATH` and
`LD_LIBRARY_PATH`. CI's `Mutation report` job has no binaries, so it keeps
listing the flags as survivors. The `FFMPEG_PATH`/`FFPROBE_PATH`/`PERL_PATH`/`EXIFTOOL_PATH`
overrides run it against system binaries instead, but those aren't the
layer's builds (Ubuntu's ffmpeg has encoders the layer leaves out).

The unit configs exclude `*.integration.test.ts`, so `pnpm check` never needs
a database.

**Enforced by lint (#496).** Every test under `packages/db/src` runs
against the real DB. `pnpm check` fails on any test there that:

- imports the fake DB (`./mocks`, `../testing`, `@nexus/db/testing`), or
- `vi.mock`s the connection, `@nexus/db` or the drivers.

Query code belongs in `packages/db` (see the server architecture in
[[../ai/conventions|Conventions]]), so the rule covers it wherever it lives
in the package. It doesn't reach tests elsewhere that hand a service a mock
`db` while mocking its repositories; those are fine.

There are no exemptions: #489 migrated the last repository tests written on
the fake before the rule. A plain unit test in the package is still fine for
logic that never reaches SQL (`compareFilesByName` in
`repositories/files.test.ts`), as long as it doesn't import the fake.

**Fixtures:** import `it` from `@nexus/db/test-db/integration` (relative
`../test-db/integration` inside `packages/db`) and ask for what the test
needs. Seed with the typed insert helpers from `@nexus/db/test-db`.

| Fixture              | Scope  | What you get                                                                                                                                                                                                                              |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                 | worker | One connection pool per Vitest worker, closed at the end. Never call `createDb` in a test.                                                                                                                                                |
| `user`               | test   | A fresh user. After the test, it and every row it owns are deleted in one statement (`deleteUsers`: every user-owned table cascades from `user`; invites it created go in the same statement).                                            |
| `createUser`         | test   | More users for this test, e.g. the other owner in an ownership test. Torn down with `user`, in that same statement.                                                                                                                       |
| `createJob`          | test   | A `background_jobs` row (`createNewJobFixture` defaults), deleted after the test. Jobs have no user to cascade from, and a leftover one crowds the admin jobs table (#419).                                                               |
| `createWebhookEvent` | test   | A `webhook_events` row (`insertWebhookEvent`), deleted after the test. Webhook events have no user to cascade from either. Its default `externalId`/`eventType` are `test`-prefixed and unique, so it can't collide with a real delivery. |

**The reference example.** Copy this one
(`packages/db/src/repositories/uploadBatches.integration.test.ts`): for each
term of the predicate, seed a row that only that term _excludes_, then assert
on what the query returns, not on how it was built.

```typescript
import { it, expect, describe } from '../test-db/integration';
import { insertUploadBatch } from '../test-db';
import { createUploadBatchRepo } from './uploadBatches';

describe('findByUserAndId', () => {
    // Asking for each of two batches: without the id term, both lookups get
    // the same one back, whichever row Postgres finds first.
    it('returns the batch asked for, not the owner’s other one', async ({
        db,
        user,
    }) => {
        const [a, b] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const repo = createUploadBatchRepo(db);

        expect((await repo.findByUserAndId(user.id, a.id))?.id).toBe(a.id);
        expect((await repo.findByUserAndId(user.id, b.id))?.id).toBe(b.id);
    });

    it('does not return another user’s batch, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const owner = await createUser();
        const batch = await insertUploadBatch(db, { userId: owner.id });

        const found = await createUploadBatchRepo(db).findByUserAndId(
            user.id,
            batch.id
        );

        expect(found).toBeUndefined();
    });
});
```

Before you push, break each behaviour a test names and watch that test go
red: delete `eq(uploadBatches.id, batchId)` and the first test fails; delete
`eq(uploadBatches.userId, userId)` and the second does. If a test stays
green, it isn't testing that behaviour. With one batch per test, the id term
could go and nothing would notice (#524): a lookup that returns the owner's
only batch is right whether or not it filtered on the id. The same goes for
an `UPDATE`/`DELETE` by id: seed a bystander row and assert it's unchanged.

**Rules of thumb:**

- **Every row belongs to a fixture user.** Rows no user owns
  (`background_jobs`, `verification`, `webhook_events`) don't cascade. A test
  that creates them deletes them itself; for jobs and webhook events,
  `createJob` and `createWebhookEvent` do it for you.
- **The dev database is shared** with e2e runs, other engineers' runs and
  manual use. Scope assertions to your own rows (by id or by your `user`),
  never to a table-wide count. A global scan that sorts oldest-first with a
  `LIMIT` needs your rows backdated to sort first (`BEFORE_ANY_REAL_ROW` and
  `backdateRetrievalRequest` in `retrieval.integration.test.ts`, #491).
  Otherwise older rows can push them out and the assertion passes or fails by
  accident.
- **Another run of the same test can be live at the same time.**
  `pnpm mutate`'s workers share one database, and engineers share dev. A test
  that seeds fixed dates for a global scan reads the other run's rows too,
  and under `pnpm mutate` that turns into spurious kills (#520). Give each
  run a window of its own when the query takes one (the random slots in
  `files.integration.test.ts`). When it wants the newest row in the table,
  run the whole test in `inRolledBackTransaction(db, async (tx) => …)` from
  the fixtures module: its rows are never committed, so no other run sees
  them (`invites.integration.test.ts` `findMany`, #524).
- **`describe.concurrent` is cheap speed.** Tests that each own their `user`
  can't collide in the DB, and on the pooler most of a test's time is round
  trips. `retrieval.integration.test.ts` runs its suites concurrently: 44 s
  sequential, 15 s concurrent. Don't use it when tests share mock state (an
  implementation installed per test, call-count assertions), as in
  `files.integration.test.ts`.
- **Mock only what leaves the process** (S3, SQS, PostHog) with `vi.mock`.
  Import `vi` from `'vitest'` itself: the mock is only hoisted when `vi` comes
  from there.

**Running against a throwaway database:**

```bash
pnpm test:integration                           # against DATABASE_URL (dev, from apps/web/.env.local)
pnpm test:integration:fresh                     # against an empty Postgres 17, started and deleted for the run
pnpm test:integration:fresh --filter=@nexus/db  # one package (args go to turbo)
```

`:fresh` starts an empty Postgres 17 (Supabase's major) from the
`embedded-postgres` binaries on a free port, applies every migration, runs the
tier, and fails if any `user` row is left afterwards. That catches a test that
creates rows outside the fixtures. It's what CI's Postgres service container
looks like (#384): no leftover rows and no other writers, so a test that
passes both here and on dev relies on neither. It's also ~10x faster (about
2 s locally vs ~22 s on the pooler). Only the database is swapped. Everything
else still comes from `apps/web/.env.local`.

CI's required `Integration tests` check does the same against a Postgres 17
service container: it runs `pnpm test:integration`, then fails if any `user`
row is left.

## Unit Tests

Unit tests are for code whose correctness doesn't depend on SQL or on other
processes: domain logic, algorithms, and route or service branches decided by
their inputs. For presentational components, unit-test the logic you extract
from them; smoke and e2e cover the rendering. For what to test and at which
level, see [Writing a test](#writing-a-test). Repository and query code goes
on the [integration tier](#integration-tests-real-database), never a fake DB.

```bash
pnpm -F web test            # Unit tests (watch mode)
pnpm -F web test:run        # Unit tests (single run)
pnpm -F web test:e2e:smoke       # All smoke tests (public + authenticated)
pnpm -F web test:e2e:flows       # Interactive flows (dedicated users)
pnpm -F web test:e2e:admin       # Admin E2E tests (serialized chain)
pnpm -F web test:e2e             # All non-destructive E2E tiers
```

**Terminal output is compact** (`e2e/reporters/compact.ts`, the e2e
counterpart of `scripts/check.mjs`): one summary line on success; on failure,
the trimmed error plus the `error-context.md` page-snapshot path. Flaky tests
(passed only on retry) are named even on green runs. Full per-test output:
`npx playwright test --reporter=list`; traces: `npx playwright show-report`.

## Code Coverage

```bash
pnpm coverage     # combined line coverage: web + db + worker (unit and integration each)
```

This is the repo's coverage number. It runs the six Vitest tiers in parallel
(about a minute, most of it the integration tier's Postgres round trips),
merges their maps, and prints a total, per-workspace rows, and the areas the
test-quality epic (#502) tracks. The merged per-file map is written to
`coverage/coverage-final.json`.

- **Every source file counts.** Each Vitest config sets `coverage.include`, so
  a file no test imports shows up at 0% instead of dropping out of the
  denominator. Before #492 the web unit config reported 82% over the 67 files
  tests happened to load; counting all of them it was 34%. When you add a
  source directory outside the include globs (`apps/web/vitest.coverage.ts`,
  `src/**` elsewhere), add it there.
- **The integration tiers need `DATABASE_URL`** (env or
  `apps/web/.env.local`). Without it the run is unit-only and the first line
  says so. `packages/db` then reads low, since its queries only run against
  Postgres in the integration tiers.
- **Warnings come first.** A skipped or failed tier, or a file Vitest couldn't
  parse (usually an unbuilt workspace dependency: run `pnpm build`), is named
  on the first lines. A failed tier exits 1 with its test failure below the
  table.
- Extra args go to every Vitest run, e.g.
  `pnpm coverage --exclude '**/files.integration.test.ts'`.
- `pnpm test:coverage` is the older per-workspace **unit-only** report behind
  `/dev/coverage`. Quote `pnpm coverage` when you mean the repo's coverage.

Coverage is a report, not a merge gate. It says which code no test runs; it
can't say whether the tests that do run would catch a bug.

**Baseline (2026-09-28, lines):** 37.9% total (web 34.0%, `packages/db`
40.7%, worker 69.1%). Details and the per-area table are in #492.

### After coding: `pnpm cov:touched`

Run this once you've written the code and before you decide which tests to
add (step 2 of [the workflow](#the-workflow)). It shows how well the code you
touched is covered, one line per file, worst first.

```bash
pnpm cov:touched                    # source files changed vs origin/main (committed, staged, unstaged, untracked)
pnpm cov:touched lib/upload/*.ts    # ...plus these files, directories or globs
pnpm cov:touched --only <paths...>  # exactly these files instead
pnpm cov:touched --all              # every source file
pnpm cov:touched --risk             # churn × coverage ranking of the changed set (--all: whole repo, top 20)
pnpm cov:touched --mutate           # also mutation-test the files: a `mut` score column (see Mutation testing)
```

```
  0.0%   0.0%      0/101  untested                apps/worker/src/handlers/generateThumbnail.ts  L16-344
  0.0%   0.0%      0/340  e2e-only                apps/web/components/dashboard/useUpload.ts  L66-1288
 78.0%  79.7%      71/91  unit+integration+e2e    packages/db/src/repositories/files.ts  L44,90,134,256,299,+7 more
100.0% 100.0%      29/29  unit+e2e                apps/web/lib/upload/parts.ts
4 files, changed vs origin/main 9c2ae16 · web unit ran 3s · 3.1s
```

Columns: line %, branch %, covered/total lines, the tiers that execute the
file, the path, and the uncovered line ranges. Once any file has a fresh
mutation result (from `--mutate` or an earlier `pnpm mutate`), a
`mut 72.7%` column shows the share of its mutants the tests killed.

- **`untested`**: no unit or integration test runs a line of it, and no
  automated e2e spec reaches it. Start here.
- **`e2e-only`**: no unit or integration test runs it, but a page an e2e spec
  tags with `@page:` reaches it (the page, its layouts, their static imports,
  and the tRPC routers and `/api` routes they call). Playwright records no
  line coverage, so e2e-only code always reads 0%. The label is a guess, and
  a generous one: it means some spec probably renders this code, not that
  any spec asserts its behaviour.
- **`+e2e`** after the tier names means the same for a file that also has
  some unit or integration coverage.

**Speed.** It reuses the per-tier maps from the last `pnpm coverage`, plus a
cache of its own earlier runs in `coverage/touched/`. A file's cached entry is
stale once the file, or any test or config of that tier, is newer than the
entry. Only stale files re-run, through `vitest related`, which runs just the
tests that import them, with coverage scoped to them. Measured on #449's file
set: 0.1s when fresh, 3.6s after editing its `lib/` and `components/` files.
If a stale file is one an integration tier runs, that tier re-runs too. On
the dev pooler the web integration tier takes about 50s of round trips;
`--unit-only` skips both integration tiers. An integration tier doesn't
re-run for a file it has never executed, as long as its tests haven't
changed.

**`--risk`** ranks by commits in the last 90 days (`--days N`) × the share of
lines no unit or integration test runs. The files that change most and are
tested least come first. `e2e-only` counts as uncovered.

**`--json`** (read by `/test-maintenance`) prints one object. Fields
are only added, never renamed:

```jsonc
{
    "version": 1,
    "mode": "changed", // "changed" | "only" | "all"
    "base": "9c2ae16…", // merge-base sha, null unless mode is "changed"
    "riskWindowDays": 90,
    "seconds": 3.1,
    "tiers": [
        // one per tier: fresh | ran | failed | unused
        {
            "name": "web unit",
            "status": "ran",
            "files": 4,
            "rerun": 2,
            "seconds": 3,
        },
    ],
    "notices": [], // skipped/failed tiers, unknown paths
    "files": [
        // worst first; by risk with --risk
        {
            "path": "apps/web/lib/format.ts",
            // untested | e2e-only | partial | covered | no-code | unmeasured (its tier failed)
            "status": "partial",
            "lines": { "covered": 15, "total": 25, "pct": 60 }, // pct is null when total is 0
            "branches": { "covered": 4, "total": 6, "pct": 66.7 },
            "uncovered": [
                [4, 4],
                [51, 73],
            ], // inclusive line ranges
            "tiers": ["unit"], // subset of ["unit", "integration"]
            "e2e": true,
            "churn": 5, // commits in the risk window
            "risk": 2, // churn × uncovered line share
            "mutation": null, // a file's `pnpm mutate` result (below) when fresh, else null
        },
    ],
}
```

It exits 1 only when a tier it had to run failed, or `--mutate` couldn't
measure. The failure is printed below the table.

### Mutation testing: `pnpm mutate`

Coverage says which lines a test ran. Mutation testing says whether any test
would notice them breaking. [Stryker](https://stryker-mutator.io) makes small
changes to your code, one at a time: `>` becomes `>=`, a condition becomes
`true`, a block is emptied, a `where` object becomes `{}`. For each change it
runs the tests that execute that line. A change that turns some test red is
**killed**. A change every test still passes on **survives**: a concrete
behaviour your tests don't pin.

Run it after `pnpm cov:touched`, on the code you changed:

```bash
pnpm mutate                    # source files changed vs origin/main (same file set as cov:touched)
pnpm mutate lib/upload/*.ts    # ...plus these files, directories or globs
pnpm mutate --only <paths...>  # exactly these files instead
pnpm mutate --all              # every source file: slow, opt-in
pnpm mutate --unit-only        # no Postgres: integration tests don't run, so real-DB-only kills read as survivors
pnpm mutate --rerun            # ignore the cache
```

```
 72.7%   136/187  apps/web/server/services/retrieval.ts
        L188  newRetrievals.length < filesToRestore.length → newRetrievals.length <= filesToRestore.length  EqualityOperator; 21 tests ran it: retrieval.integration.test.ts, retrieval.test.ts
        L584  artifactWindowEnd(artifact.completedAt) <= new Date() → artifactWindowEnd(artifact.completedAt) < new Date()  EqualityOperator; 4 tests ran it: retrieval.test.ts
        +45 more survivors (--json, or the HTML report)
        no test runs L203-209,L564-568 (5 mutants)
 95.6%     43/45  packages/db/src/repositories/retrievals.ts
        L93   { where: eq(schema.retrievals.userId, userId), } → {}  ObjectLiteral; 3 tests ran it: retrieval.integration.test.ts, retrievals.test.ts
2 files · 232 mutants, 179 killed (77.2%; 78.9% of those a test runs) · named files · 79.4s
```

Per file: the score (killed / all mutants), then each survivor with its line,
the code before → after, the mutator, and which test files ran that line.
Mutants no test runs at all are summed up as line ranges; `pnpm cov:touched`
already shows those as uncovered. The full report, every mutant in the
source, is `coverage/mutation/mutation.html`.

**Every tier judges every mutant.** All six Vitest tiers run in one Stryker
run, so a repository mutant is killed by the db integration tests on a real
Postgres or by the web service tests over it, whichever notices. The
integration tiers run on a throwaway Postgres (as in
`pnpm test:integration:fresh`), started and deleted for the run.
`publish.integration.test.ts` is skipped (`INTEGRATION_SKIP_AWS`): it would
send a real SQS message per mutant.

**Reading survivors.** Each one is a question: would a user, or a caller,
notice this change?

- **Yes: that's a test gap.** Write the test that fails on the mutated
  code, and check it does: make the change by hand, watch the test go red,
  revert. A boundary survivor (`>` → `>=`) wants a test at exactly the
  boundary. A `where: {…} → {}` survivor wants a test with a row the filter
  must exclude (another user's, a deleted one): see "Integration Tests (real
  database)".
- **No: it's equivalent.** Some mutants can't change behaviour (a log
  message, an optimisation that gives the same answer). Don't write a test
  that pins them. If one keeps coming back, mark it where it lives:
  `// Stryker disable next-line StringLiteral: log text only`.
- **Not sure: it's a finding.** Mention it in the PR rather than guessing.

`runs at import` means the mutated code runs when the module loads (a
top-level constant, a factory's object literal), so every related test ran
against it and none failed.

**Speed.** Measured locally (16 cores; up to 8 Stryker workers), all tiers,
from cold:

| File set                                                               | Mutants | Time |
| ---------------------------------------------------------------------- | ------: | ---: |
| One `lib/` file (`preflight.ts`)                                       |      19 |   8s |
| PR #466: a page, two components, `status.ts`                           |     625 |  17s |
| PR #449: 7 files incl. `useUpload.ts` and `repositories/files.ts`      |    1551 |  46s |
| A repository and the service over it (`retrievals.ts`, `retrieval.ts`) |     232 |  79s |

Mutants no test runs cost nothing, so big untested files are cheap. Time
goes into mutants that integration tests cover. Results are cached in
`coverage/mutation/cache.json` per file, like `cov:touched`'s: a file is
re-mutated when it, or any test or Vitest config, is newer than its result.

**How it runs, and what to know.** Stryker instruments the files **in
place** for the length of the run and restores them afterwards (on Ctrl-C
too), so don't edit them while it runs. If a run is killed hard, the next
one refuses to start on a file that still holds instrumentation, and says
where the backup is. The why of each setting (in-place, no bail, one test at
a time) is in `scripts/coverage/mutation.mjs`. Before mutating anything it
runs the related tests once: a red test, or a test file that fails to
import, stops the run with the failure. Stryker would silently skip that
file and report its mutants as survivors.

**In CI** the `Mutation report` job runs `pnpm mutate` on every PR's changed
files against the Postgres service container, and writes the table and the
survivors to the job summary, with the HTML report as an artifact. It is a
report, not a gate: never a required check, and never red.

**`--json`** (read by `/test-maintenance`). Fields are only added,
never renamed. `--markdown` prints the CI summary instead.

```jsonc
{
    "version": 1,
    "mode": "changed", // "changed" | "only" | "all"
    "base": "9c2ae16…", // merge-base sha, null unless mode is "changed"
    "seconds": 79.4,
    "tiers": [
        "web unit",
        "web integration",
        "db unit",
        "db integration",
        "worker unit",
    ],
    "mutated": ["apps/web/server/services/retrieval.ts"], // files Stryker ran on this time; the rest came from the cache
    "notices": [],
    "failure": null, // why nothing was measured (red tests, Stryker error), else null
    "killed": 179,
    "total": 232,
    "score": 77.2, // killed / total, percent; null when there are no mutants
    "coveredScore": 78.9, // killed / mutants some test runs
    "files": [
        // worst first; a file whose run failed is { "path", "status": "unmeasured" }
        {
            "path": "packages/db/src/repositories/retrievals.ts",
            "tested": true, // false when no test imports any file in the run (score, noCoverage, total are then null)
            "score": 95.6,
            "killed": 43, // Stryker's Killed + Timeout
            "survived": 2,
            "noCoverage": 0, // mutants no test runs
            "total": 45, // killed + survived + noCoverage
            "survivors": [
                {
                    "line": 93,
                    "column": 41,
                    "mutator": "ObjectLiteral",
                    "original": "{ where: eq(schema.retrievals.userId, userId), }",
                    "replacement": "{}",
                    "static": false, // true: runs at import
                    // A fake-DB test can't see a dropped `where` (#489).
                    "coveredBy": [
                        "retrievals.test.ts › retrievals repository findByUser returns all retrievals for user",
                        "…",
                    ],
                },
            ],
            "noCoverageLines": [], // inclusive line ranges of mutants no test runs
            // Each test that ran any of the file's mutants: how many it ran and
            // how many turned it red, weakest first. Static mutants are left
            // out. A timeout names no test, so it counts in `timedOut` (not in
            // `ran`) for every test that covers it. `ran > 0, killed: 0` is a
            // test that runs this code and notices nothing. `test` names the
            // file by basename, which repeats across packages (files.test.ts):
            // `file` is exact.
            "tests": [
                {
                    "test": "retrievals.integration.test.ts › findByFileId …",
                    "file": "packages/db/src/repositories/retrievals.integration.test.ts",
                    "ran": 12,
                    "killed": 9,
                    "timedOut": 0,
                },
            ],
        },
    ],
}
```

It exits 1 when nothing could be measured (the `failure` above), else 0,
survivors or not.

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
