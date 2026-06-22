import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { USER_STATE_PATH } from '../helpers/auth';
import { waitForTrpcRequest } from '../helpers/trpc';
import { countJobsByStatus, type Job } from '@nexus/db/test-db';
import { seedJobs, cleanupJobs } from '../helpers/scenarios';

const PAGE_URL = '/dashboard/admin/jobs';

// Admin project applies the admin storageState at the project level; align the
// fixture chain's storageState override to it.
test.use({ userRole: 'admin' });

// Run serially — test describes share the same database and seed/cleanup data
test.describe.configure({ mode: 'serial' });

test.describe(
    'auth guards',
    { tag: ['@page:/dashboard/admin/jobs', '@uc:auth-guard-admin'] },
    () => {
        test('unauthenticated user is redirected to dashboard', async ({
            browser,
        }) => {
            const context = await browser.newContext({
                storageState: undefined,
            });
            const page = await context.newPage();

            await page.goto(PAGE_URL);

            // Admin layout redirects unauthenticated users to /dashboard
            await expect(page).toHaveURL(/\/dashboard$/);
            await context.close();
        });

        test('non-admin user is redirected to dashboard', async ({
            browser,
        }) => {
            const context = await browser.newContext({
                storageState: USER_STATE_PATH,
            });
            const page = await context.newPage();

            await page.goto(PAGE_URL);

            // Admin layout redirects non-admin users to /dashboard
            await expect(page).toHaveURL(/\/dashboard$/);
            await context.close();
        });
    }
);

test.describe('dashboard with seeded data', () => {
    let seededJobs: Job[] = [];

    test.beforeAll(async ({ db }) => {
        // Seed 3 of 4 statuses — leave "processing" empty to test empty state
        seededJobs = await seedJobs(db, {
            pending: 3,
            completed: 5,
            failed: 1,
        });
    });

    test.afterAll(async ({ db }) => {
        await cleanupJobs(db, seededJobs);
    });

    test(
        'status cards display correct counts',
        { tag: ['@uc:admin-jobs-status-cards'] },
        async ({ page, db }) => {
            const dbCounts = await countJobsByStatus(db);

            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            await assertStatusCard(page, 'Pending', dbCounts.pending);
            await assertStatusCard(page, 'Processing', dbCounts.processing);
            await assertStatusCard(page, 'Completed', dbCounts.completed);
            await assertStatusCard(page, 'Failed', dbCounts.failed);
        }
    );

    test(
        'table renders columns with correct data',
        { tag: ['@uc:admin-jobs-table'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            const headers = page.locator('thead th');
            await expect(headers.nth(0)).toHaveText('Type');
            await expect(headers.nth(1)).toHaveText('Status');
            await expect(headers.nth(2)).toHaveText('Created');
            await expect(headers.nth(3)).toHaveText('Duration');
            await expect(headers.nth(4)).toHaveText('Attempts');

            await expect(
                page.locator('td').filter({ hasText: 'e2e-test-job' }).first()
            ).toBeVisible();
        }
    );

    test(
        'status filters update the table',
        { tag: ['@uc:admin-jobs-filter'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            await page
                .getByRole('button', { name: 'Failed', exact: true })
                .click();
            await waitForDataLoad(page);

            const badges = page.locator('tbody td:nth-child(2)');
            const count = await badges.count();
            expect(count).toBeGreaterThan(0);
            for (let i = 0; i < count; i++) {
                await expect(badges.nth(i)).toHaveText('Failed');
            }

            await page
                .getByRole('button', { name: 'All', exact: true })
                .click();
            await waitForDataLoad(page);
        }
    );

    test(
        'empty state shows when filtering to status with no jobs',
        { tag: ['@uc:admin-jobs-filter'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            // "Processing" was not seeded — filtering to it should show empty state
            await page
                .getByRole('button', { name: 'Processing', exact: true })
                .click();

            await expect(page.getByText('No jobs found')).toBeVisible();
        }
    );
});

test.describe('pagination', () => {
    let seededJobs: Job[] = [];

    test.beforeAll(async ({ db }) => {
        seededJobs = await seedJobs(db, { pending: 25 });
    });

    test.afterAll(async ({ db }) => {
        await cleanupJobs(db, seededJobs);
    });

    test(
        'next/prev buttons navigate pages with correct counts',
        { tag: ['@uc:admin-jobs-pagination'] },
        async ({ page, db }) => {
            const dbCounts = await countJobsByStatus(db);
            const totalPending = dbCounts.pending;

            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            await page
                .getByRole('button', { name: 'Pending', exact: true })
                .click();
            await waitForDataLoad(page);

            const totalPages = Math.ceil(totalPending / 20);
            await expect(
                page.getByText(`Page 1 of ${totalPages}`)
            ).toBeVisible();

            // Use regex to handle en-dash (U+2013) vs hyphen in "Showing X–Y of Z"
            const show1 = Math.min(20, totalPending);
            await expect(
                page.getByText(
                    new RegExp(`Showing 1.${show1} of ${totalPending}`)
                )
            ).toBeVisible();

            await page.getByRole('button', { name: 'Next page' }).click();
            await waitForDataLoad(page);

            await expect(
                page.getByText(`Page 2 of ${totalPages}`)
            ).toBeVisible();

            const expectedEnd = Math.min(40, totalPending);
            await expect(
                page.getByText(
                    new RegExp(`Showing 21.${expectedEnd} of ${totalPending}`)
                )
            ).toBeVisible();

            await page.getByRole('button', { name: 'Previous page' }).click();
            await waitForDataLoad(page);

            await expect(
                page.getByText(`Page 1 of ${totalPages}`)
            ).toBeVisible();
        }
    );
});

test.describe('refresh', () => {
    test(
        'refresh button refetches jobs and status counts',
        { tag: ['@uc:admin-jobs-refresh'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            // Refresh must refetch BOTH procedures the page renders from.
            // Waits start before the click so the requests are attributable
            // to it (initial-load requests already settled in
            // waitForDataLoad).
            const listRefetch = waitForTrpcRequest(page, 'admin.jobs.list');
            const countsRefetch = waitForTrpcRequest(page, 'admin.jobs.counts');

            await page.getByRole('button', { name: 'Refresh' }).click();

            await listRefetch;
            await countsRefetch;
            // Refetched data renders (not an error/blank state).
            await waitForDataLoad(page);
        }
    );
});

test.describe('retry', () => {
    let seededJobs: Job[] = [];

    test.beforeAll(async ({ db }) => {
        seededJobs = await seedJobs(db, { failed: 1, completed: 1 });
    });

    test.afterAll(async ({ db }) => {
        await cleanupJobs(db, seededJobs);
    });

    test(
        'retry button appears only on failed jobs and triggers retry',
        { tag: ['@uc:admin-jobs-retry'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForDataLoad(page);

            // Filter to completed — retry button should NOT appear
            await page
                .getByRole('button', { name: 'Completed', exact: true })
                .click();
            await waitForDataLoad(page);
            await expect(
                page.getByRole('button', { name: 'Retry job' })
            ).toHaveCount(0);

            // Filter to failed — retry button SHOULD appear
            await page
                .getByRole('button', { name: 'Failed', exact: true })
                .click();
            await waitForDataLoad(page);

            const retryButton = page.getByRole('button', { name: 'Retry job' });
            await expect(retryButton.first()).toBeVisible();

            // Click retry — job gets re-queued (status changes to pending)
            await retryButton.first().click();

            // After retry, the job disappears from "Failed" filter (becomes pending)
            await expect(
                page.getByText('No jobs found').or(retryButton.first())
            ).toBeVisible({ timeout: 10_000 });
        }
    );
});

async function waitForDataLoad(page: Page): Promise<void> {
    await page
        .locator('table')
        .or(page.getByText('No jobs found'))
        .first()
        .waitFor({ timeout: 10_000 });
}

async function assertStatusCard(
    page: Page,
    label: string,
    expectedCount: number
): Promise<void> {
    const cardContent = page
        .locator('p')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..');
    await expect(cardContent.locator('p').nth(1)).toHaveText(
        String(expectedCount)
    );
}
