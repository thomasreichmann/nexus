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

| Helper                | Purpose                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `e2e/helpers/auth.ts` | Create users, promote to admin, save `storageState`, `provisionDedicatedUser` for flows specs  |
| `e2e/helpers/seed.ts` | Seed/cleanup test data (jobs, etc.)                                                            |
| `e2e/helpers/db.ts`   | Direct DB access via raw `postgres` driver (`insertFile`/`insertBatch`/`deleteUserData`, etc.) |
| `e2e/helpers/trpc.ts` | Batch-safe tRPC request matching: `interceptTrpcCalls` (record + abort), `waitForTrpcRequest`  |

**Asserting on tRPC traffic:** never match procedure URLs with substrings or
hand-rolled regexes — `httpBatchLink` can merge same-tick calls into
`/api/trpc/<a>,<b>?batch=1`, which breaks both. Use `e2e/helpers/trpc.ts`,
which matches the procedure as a full path segment.

**Auth setup runs as a Playwright project** (`global.setup.ts`), not `globalSetup` config — because `globalSetup` runs before `webServer` starts, making API calls impossible.

**Adding a new test suite:** Create `e2e/admin/your-feature.spec.ts` — the `admin` project auto-matches all files under `admin/`. Auth `storageState` is applied automatically; no per-test login needed. For seed data, add domain-specific helpers to `e2e/helpers/seed.ts` (see `seedJobs`/`cleanupJobs` as the reference implementation).

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
- `flows` — Interactive user flows (matches `flows/`). Each spec provisions a **dedicated user** in `beforeAll` via `provisionDedicatedUser` from `e2e/helpers/auth.ts`, so empty-state and exact-count assertions can't race other specs.
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

- `e2e/helpers/db.ts` uses raw `postgres` driver, not `@nexus/db` — Playwright's CJS resolution can't handle the workspace package's TypeScript source exports + vitest barrel dependency
- BetterAuth API calls require an `Origin` header for CSRF
- Raw SQL INSERTs need `gen_random_uuid()` — Drizzle's `$defaultFn` only runs through the ORM
- React Query retries failed requests 3x (~7s) — use `{ timeout: 15_000 }` for auth guard tests
- Use `test.describe.configure({ mode: 'serial' })` when tests share seeded DB data

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
