/**
 * The dashboard's Recent Uploads preview and Retrievals card speak the file
 * browser's derived status vocabulary, not the raw DB column (#358, #413).
 *
 * DB `files.status = 'available'` means "archived, not downloadable", so a
 * surface that prints the column shows "Available" for a file the file browser
 * calls Archived. Every seeded file here is DB `available` or `restoring`; what
 * each row must read is decided by its active retrieval.
 *
 * Its own dedicated user, like the other flows, so the exact counts on the
 * Retrievals card can't race a spec sharing the regular user.
 */
import {
    type File,
    deleteUserData,
    insertFile,
    insertRetrieval,
} from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { fileName } from '../helpers/table';

const DASHBOARD_USER: TestUser = {
    email: 'dashboard-status-e2e@test.local',
    password: 'dashboard-status-e2e-password-123',
    name: 'Dashboard Status E2E',
};
const STATE_PATH = 'e2e/.auth/dashboard-status.json';
const PAGE_URL = '/dashboard';

interface SeededFiles {
    /** DB `available`, no retrieval: the case #358 rendered as "Available". */
    untouched: File;
    /** DB `available` with a `ready` retrieval: downloadable right now. */
    thawed: File;
    /** DB `restoring` with an `in_progress` retrieval. */
    thawing: File;
}

const test = base.extend<NonNullable<unknown>, { seededFiles: SeededFiles }>({
    seededFiles: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const untouched = await insertFile(db, {
                userId,
                name: 'dash-untouched.txt',
                size: 500,
                status: 'available',
            });
            const thawed = await insertFile(db, {
                userId,
                name: 'dash-thawed.pdf',
                size: 3000,
                status: 'available',
            });
            await insertRetrieval(db, {
                userId,
                fileId: thawed.id,
                status: 'ready',
            });
            const thawing = await insertFile(db, {
                userId,
                name: 'dash-thawing.mov',
                size: 4000,
                status: 'restoring',
            });
            await insertRetrieval(db, {
                userId,
                fileId: thawing.id,
                status: 'in_progress',
            });

            await use({ untouched, thawed, thawing });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({
    dedicatedUserConfig: { user: DASHBOARD_USER, statePath: STATE_PATH },
});

test(
    'desktop Recent Uploads shows derived status, not the DB column',
    { tag: ['@page:/dashboard', '@uc:dashboard-recent-uploads-status'] },
    async ({ page, seededFiles }) => {
        await page.goto(PAGE_URL);
        await expect(fileName(page, seededFiles.untouched.name)).toBeVisible();

        const row = (file: File) => page.locator('tr', { hasText: file.name });
        await expect(
            row(seededFiles.untouched).getByText('Archived', { exact: true })
        ).toBeVisible();
        await expect(
            row(seededFiles.thawed).getByText('Ready to download', {
                exact: true,
            })
        ).toBeVisible();
        await expect(
            row(seededFiles.thawing).getByText('Retrieving', { exact: true })
        ).toBeVisible();

        await expect(page.getByText('Available', { exact: true })).toHaveCount(
            0
        );
    }
);

test(
    'mobile Recent Uploads shows the same derived status',
    { tag: ['@page:/dashboard', '@uc:dashboard-recent-uploads-status'] },
    async ({ page, seededFiles }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(PAGE_URL);
        await expect(fileName(page, seededFiles.untouched.name)).toBeVisible();

        // The desktop table is display:none below sm; scope to the visible
        // stacked rows so a pass can't come from the hidden copy.
        const row = (file: File) =>
            page
                .locator('li', { hasText: file.name })
                .filter({ visible: true });
        await expect(
            row(seededFiles.untouched).getByText('Archived', { exact: true })
        ).toBeVisible();
        await expect(
            row(seededFiles.thawed).getByText('Ready to download', {
                exact: true,
            })
        ).toBeVisible();
        await expect(
            row(seededFiles.thawing).getByText('Retrieving', { exact: true })
        ).toBeVisible();
    }
);

test(
    'Retrievals card counts a ready retrieval apart from in-progress ones',
    { tag: ['@page:/dashboard', '@uc:dashboard-retrievals-count'] },
    async ({ page, seededFiles }) => {
        await page.goto(PAGE_URL);
        await expect(fileName(page, seededFiles.untouched.name)).toBeVisible();

        // One thawing, one thawed: the thawed one is waiting on the user, so
        // it must not inflate the in-progress count.
        await expect(
            page.getByText('in progress · 1 ready to download', { exact: true })
        ).toBeVisible();
        await expect(page.getByText(/\bactive$/)).toHaveCount(0);

        // At lg the card is a fixed w-80 column and Badge is nowrap: the
        // header badge must stay inside the card with both counts showing.
        await page.setViewportSize({ width: 1024, height: 900 });
        const badge = page.getByText('1 restoring · 1 ready', { exact: true });
        await expect(badge).toBeVisible();
        const card = page.locator('[data-slot="card"]', { has: badge });
        const badgeBox = (await badge.boundingBox())!;
        const cardBox = (await card.boundingBox())!;
        expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(
            cardBox.x + cardBox.width
        );
    }
);
