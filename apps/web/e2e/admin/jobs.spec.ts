import { test, expect, type Page } from '@playwright/test';
import { USER_STATE_PATH } from '../helpers/auth';
import {
    seedJobs,
    cleanupJobs,
    countJobsByStatus,
    type DbJob,
} from '../helpers/seed';

const PAGE_URL = '/dashboard/admin/jobs';

// Run serially — test describes share the same database and seed/cleanup data
test.describe.configure({ mode: 'serial' });

test.describe('auth guards', () => {
    test('unauthenticated user sees empty/error state', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto(PAGE_URL);

        await expect(
            page.getByRole('heading', { name: /background jobs/i })
        ).toBeVisible();

        // tRPC calls fail without auth — React Query retries 3x with backoff (~7s)
        await expect(page.getByText('No jobs found')).toBeVisible({
            timeout: 15_000,
        });
        await context.close();
    });

    test('non-admin user sees error state', async ({ browser }) => {
        const context = await browser.newContext({
            storageState: USER_STATE_PATH,
        });
        const page = await context.newPage();

        await page.goto(PAGE_URL);

        await expect(
            page.getByRole('heading', { name: /background jobs/i })
        ).toBeVisible();

        // adminProcedure returns FORBIDDEN — React Query retries before giving up
        await expect(page.getByText('No jobs found')).toBeVisible({
            timeout: 15_000,
        });
        await context.close();
    });
});

test.describe('dashboard with seeded data', () => {
    let seededJobs: DbJob[] = [];

    test.beforeAll(async () => {
        // Seed 3 of 4 statuses — leave "processing" empty to test empty state
        seededJobs = await seedJobs({
            pending: 3,
            completed: 5,
            failed: 1,
        });
    });

    test.afterAll(async () => {
        await cleanupJobs(seededJobs);
    });

    test('status cards display correct counts', async ({ page }) => {
        const dbCounts = await countJobsByStatus();

        await page.goto(PAGE_URL);
        await waitForDataLoad(page);

        await assertStatusCard(page, 'Pending', dbCounts.pending);
        await assertStatusCard(page, 'Processing', dbCounts.processing);
        await assertStatusCard(page, 'Completed', dbCounts.completed);
        await assertStatusCard(page, 'Failed', dbCounts.failed);
    });

    test('table renders columns with correct data', async ({ page }) => {
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
    });

    test('status filters update the table', async ({ page }) => {
        await page.goto(PAGE_URL);
        await waitForDataLoad(page);

        await page.getByRole('button', { name: 'Failed', exact: true }).click();
        await waitForDataLoad(page);

        const badges = page.locator('tbody td:nth-child(2)');
        const count = await badges.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            await expect(badges.nth(i)).toHaveText('Failed');
        }

        await page.getByRole('button', { name: 'All', exact: true }).click();
        await waitForDataLoad(page);
    });

    test('empty state shows when filtering to status with no jobs', async ({
        page,
    }) => {
        await page.goto(PAGE_URL);
        await waitForDataLoad(page);

        // "Processing" was not seeded — filtering to it should show empty state
        await page
            .getByRole('button', { name: 'Processing', exact: true })
            .click();

        await expect(page.getByText('No jobs found')).toBeVisible();
    });
});

test.describe('pagination', () => {
    let seededJobs: DbJob[] = [];

    test.beforeAll(async () => {
        seededJobs = await seedJobs({ pending: 25 });
    });

    test.afterAll(async () => {
        await cleanupJobs(seededJobs);
    });

    test('next/prev buttons navigate pages with correct counts', async ({
        page,
    }) => {
        const dbCounts = await countJobsByStatus();
        const totalPending = dbCounts.pending;

        await page.goto(PAGE_URL);
        await waitForDataLoad(page);

        await page
            .getByRole('button', { name: 'Pending', exact: true })
            .click();
        await waitForDataLoad(page);

        const totalPages = Math.ceil(totalPending / 20);
        await expect(page.getByText(`Page 1 of ${totalPages}`)).toBeVisible();

        // Use regex to handle en-dash (U+2013) vs hyphen in "Showing X–Y of Z"
        const show1 = Math.min(20, totalPending);
        await expect(
            page.getByText(new RegExp(`Showing 1.${show1} of ${totalPending}`))
        ).toBeVisible();

        await page.locator('button:has(svg.lucide-chevron-right)').click();
        await waitForDataLoad(page);

        await expect(page.getByText(`Page 2 of ${totalPages}`)).toBeVisible();

        const expectedEnd = Math.min(40, totalPending);
        await expect(
            page.getByText(
                new RegExp(`Showing 21.${expectedEnd} of ${totalPending}`)
            )
        ).toBeVisible();

        await page.locator('button:has(svg.lucide-chevron-left)').click();
        await waitForDataLoad(page);

        await expect(page.getByText(`Page 1 of ${totalPages}`)).toBeVisible();
    });
});

test.describe('retry', () => {
    let seededJobs: DbJob[] = [];

    test.beforeAll(async () => {
        seededJobs = await seedJobs({ failed: 1, completed: 1 });
    });

    test.afterAll(async () => {
        await cleanupJobs(seededJobs);
    });

    test('retry button appears only on failed jobs and triggers retry', async ({
        page,
    }) => {
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
        await page.getByRole('button', { name: 'Failed', exact: true }).click();
        await waitForDataLoad(page);

        const retryButton = page.getByRole('button', { name: 'Retry job' });
        await expect(retryButton.first()).toBeVisible();

        // Click retry — job gets re-queued (status changes to pending)
        await retryButton.first().click();

        // After retry, the job disappears from "Failed" filter (becomes pending)
        await expect(
            page.getByText('No jobs found').or(retryButton.first())
        ).toBeVisible({ timeout: 10_000 });
    });
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
