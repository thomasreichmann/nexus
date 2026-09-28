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
| `userRole`      | `'admin' \| 'user'` | `'user'` | Selects auth state (`e2e/.auth/admin.json` or `user.json`)                |
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

- `setup` — Creates test users and saves auth state to `e2e/.auth/`
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

| Code under test                                 | Home                                       | Command                               |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| A repository or query (`packages/db/src/...`)   | `packages/db/src/**/x.integration.test.ts` | `pnpm -F @nexus/db test:integration`  |
| A service whose behaviour is SQL (`apps/web/…`) | `apps/web/**/x.integration.test.ts`        | `pnpm -F @nexus/web test:integration` |
| Both packages                                   |                                            | `pnpm test:integration`               |

The unit configs exclude `*.integration.test.ts`, so `pnpm check` never needs
a database.

**Fixtures:** import `it` from `@nexus/db/test-db/integration` (relative
`../test-db/integration` inside `packages/db`) and ask for what the test
needs. Seed with the typed insert helpers from `@nexus/db/test-db`.

| Fixture      | Scope  | What you get                                                                                                                                                                                     |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db`         | worker | One connection pool per Vitest worker, closed at the end. Never call `createDb` in a test.                                                                                                       |
| `user`       | test   | A fresh user. After the test, it and every row it owns are deleted in one statement (`deleteUsers`: every user-owned table cascades from `user`; invites it created go in the same statement).   |
| `createUser` | test   | More users for this test, e.g. the other owner in an ownership test. Torn down with `user`, in that same statement.                                                                              |
| `fileUser`   | file   | One user shared by the file's tests, deleted after the last one. For a suite where a user per test costs more round trips than its isolation is worth. Its rows pile up across the file's tests. |

**The reference example.** Copy this one
(`packages/db/src/repositories/uploadBatches.integration.test.ts`): seed the
row the predicate must _exclude_, then assert on what the query returns, not
on how it was built.

```typescript
import { it, expect, describe } from '../test-db/integration';
import { insertUploadBatch } from '../test-db';
import { createUploadBatchRepo } from './uploadBatches';

describe('findByUserAndId', () => {
    it('returns the batch to its owner', async ({ db, user }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });

        const found = await createUploadBatchRepo(db).findByUserAndId(
            user.id,
            batch.id
        );

        expect(found?.id).toBe(batch.id);
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

Before you push, break the behaviour the test names (delete the
`eq(uploadBatches.userId, userId)` above) and watch the test go red. If it
stays green, it isn't testing that behaviour.

**Rules of thumb:**

- **Every row belongs to a fixture user.** Rows no user owns
  (`background_jobs`, `verification`) don't cascade. A test that creates them
  deletes them itself.
- **The dev database is shared** with e2e runs, other engineers' runs and
  manual use. Scope assertions to your own rows (by id or by your `user`),
  never to a table-wide count. A global scan that sorts oldest-first with a
  `LIMIT` needs your rows backdated to sort first (`BEFORE_ANY_REAL_ROW` and
  `backdateRetrievalRequest` in `retrieval.integration.test.ts`, #491).
  Otherwise older rows can push them out and the assertion passes or fails by
  accident.
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

## Unit Tests

Unit test utilities and pure functions with logic. Skip unit tests for presentational components — E2E tests cover those better.

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
pnpm coverage     # combined line coverage: web unit + web integration + packages/db + worker
```

This is the repo's coverage number. It runs the four Vitest tiers in parallel
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
- **The integration tier needs `DATABASE_URL`** (env or
  `apps/web/.env.local`). Without it the run is unit-only and the first line
  says so; `packages/db` then reads low, since its queries are only exercised
  against Postgres through the web integration tests.
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

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
