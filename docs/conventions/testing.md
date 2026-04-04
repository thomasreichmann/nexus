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

| Helper                | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `e2e/helpers/auth.ts` | Create users, promote to admin, save `storageState` |
| `e2e/helpers/seed.ts` | Seed/cleanup test data (jobs, etc.)                 |
| `e2e/helpers/db.ts`   | Direct DB access via raw `postgres` driver          |

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

**Playwright config** has three projects:

- `setup` — Creates test users and saves auth state to `e2e/.auth/`
- `smoke` — All smoke tests (public + authenticated, depends on `setup`, matches `smoke/`)
- `admin` — Authenticated E2E tests (uses `storageState`, depends on `setup`, matches `admin/`)

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
pnpm -F web test:e2e:admin       # Admin E2E tests (authenticated)
pnpm -F web test:e2e             # All E2E tests
```

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
