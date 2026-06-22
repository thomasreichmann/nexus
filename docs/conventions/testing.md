---
title: Testing
created: 2026-03-07
updated: 2026-03-07
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

**Key gotchas:**

- Back-door seeding goes through `@nexus/db/test-db` (typed, connection-injectable) — `createDb(url)` resolves and queries the dev DB cleanly under Playwright. Do not drop to a raw `postgres` driver or hand-written SQL; the typed insert helpers fill ids/`s3Key` so there's no manual `gen_random_uuid()`. (`@nexus/db/testing` is the unit-test surface and pulls `vitest`, so it must not be imported from e2e — that's why `test-db` is a separate, vitest-free entrypoint.)
- BetterAuth API calls require an `Origin` header for CSRF
- BetterAuth sign-in/up (not `insertUser`) is the only way to make a user that can authenticate through the UI — `insertUser` writes the bare `user` row, no password/account
- React Query retries failed requests 3x (~7s) — use `{ timeout: 15_000 }` for auth guard tests
- Use `test.describe.configure({ mode: 'serial' })` when tests share seeded DB data; mutations that invalidate a query while its initial fetch is still in flight should `cancelQueries` + `refetchQueries` (not just `invalidateQueries`), or the stale result wins

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

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
