/**
 * Public share links: the anonymous uploader at /share and a link's files at
 * /s/<id>. Runs unauthenticated (bare smoke project), like invite.spec.ts.
 *
 * The browser→S3 leg is answered by a route stub, so a whole upload runs
 * against the real server and database without a bucket: the e2e server's
 * S3_SHARES_BUCKET is synthetic, and presigning never leaves the process.
 */
import { test, expect } from '@playwright/test';
import {
    deleteShares,
    insertShare,
    type ShareWithFiles,
} from '@nexus/db/test-db';
import { createTestDb } from '../helpers/connection';
import { fileName } from '../helpers/table';
import { stubS3Puts } from '../helpers/uploadStubs';
import { setupConsoleErrorTracking } from '../utils';

const HOUR_MS = 60 * 60 * 1000;

/**
 * An address of its own for each run, from the range reserved for
 * documentation. Creation is limited per IP, and every run from this machine
 * would otherwise spend the same day's allowance. Off Vercel nothing
 * overwrites the header, so the server takes it at its word.
 */
function uniqueClientIp(): string {
    const octet = () => Math.floor(Math.random() * 256);
    return `203.0.113.${octet()}, 10.${octet()}.${octet()}.${octet()}`;
}

const textFile = (name: string, content = 'hello') => ({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
});

test.describe('public share links', () => {
    let db: ReturnType<typeof createTestDb>;
    let liveShare: ShareWithFiles;
    let unfinishedShare: ShareWithFiles;
    let expiredShare: ShareWithFiles;
    let exhaustedShare: ShareWithFiles;
    // Links created through the UI, where only the page knows the id.
    const uploadedShareIds: string[] = [];

    test.beforeAll(async () => {
        // Outside the fixture chain (no worker `db` fixture), so hold a
        // direct connection for seeding and cleanup.
        db = createTestDb();
        liveShare = await insertShare(
            db,
            { status: 'ready', expiresAt: new Date(Date.now() + 5 * HOUR_MS) },
            [
                { name: 'holiday-photos.zip', size: 3 * 1024 * 1024 },
                { name: 'notes.txt', size: 512 },
            ]
        );
        exhaustedShare = await insertShare(db, { status: 'ready' }, [
            // Far past any limit the app would set.
            { name: 'popular.zip', downloadCount: 1_000_000 },
        ]);
        unfinishedShare = await insertShare(db, { status: 'uploading' });
        expiredShare = await insertShare(db, {
            status: 'ready',
            expiresAt: new Date(Date.now() - 60_000),
        });
    });

    test.afterAll(async () => {
        try {
            await deleteShares(db, [
                liveShare.id,
                exhaustedShare.id,
                unfinishedShare.id,
                expiredShare.id,
                ...uploadedShareIds,
            ]);
        } finally {
            await db.$client.end({ timeout: 5 });
        }
    });

    test(
        'the share page renders without console errors',
        { tag: ['@page:/share'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/share');

            await expect(
                page.getByRole('heading', { name: 'Share files' })
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Choose files' })
            ).toBeVisible();
            expect(errors).toEqual([]);
        }
    );

    test(
        'uploading files gives a link that lists them',
        { tag: ['@page:/share', '@page:/s/[id]', '@uc:share-create-link'] },
        async ({ page }) => {
            await page.setExtraHTTPHeaders({
                'x-forwarded-for': uniqueClientIp(),
            });
            const s3 = await stubS3Puts(page);
            await page.goto('/share');

            await page
                .getByTestId('share-file-input')
                .setInputFiles([
                    textFile('itinerary.txt'),
                    textFile('packing-list.txt', 'socks'),
                ]);
            await page.getByRole('button', { name: 'Get a link' }).click();

            await expect(
                page.getByRole('heading', { name: 'Your link is ready' })
            ).toBeVisible();
            const link = await page.getByLabel('Share link').inputValue();
            uploadedShareIds.push(link.split('/s/')[1]!);
            expect(s3.total).toBe(2);

            await page.goto(link);

            await expect(
                page.getByRole('heading', { name: '2 files shared with you' })
            ).toBeVisible();
            await expect(fileName(page, 'itinerary.txt')).toBeVisible();
            await expect(fileName(page, 'packing-list.txt')).toBeVisible();
        }
    );

    test(
        'more files than a link holds are refused before anything uploads',
        { tag: ['@page:/share', '@uc:share-selection-over-limit'] },
        async ({ page }) => {
            await page.goto('/share');

            await page
                .getByTestId('share-file-input')
                .setInputFiles(
                    Array.from({ length: 51 }, (_, i) => textFile(`${i}.txt`))
                );

            await expect(
                page.getByText('A link holds up to 50 files')
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Get a link' })
            ).toBeDisabled();
        }
    );

    test(
        'a live link lists its files without console errors',
        { tag: ['@page:/s/[id]'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto(`/s/${liveShare.id}`);

            await expect(
                page.getByRole('heading', { name: '2 files shared with you' })
            ).toBeVisible();
            await expect(fileName(page, 'holiday-photos.zip')).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Download notes.txt' })
            ).toBeVisible();
            expect(errors).toEqual([]);
        }
    );

    test(
        'downloading a file fetches it from storage under its own name',
        { tag: ['@page:/s/[id]', '@uc:share-download-file'] },
        async ({ page }) => {
            // Stands in for S3 (or CloudFront, where a dev env has one
            // configured): only the real thing reads the signed
            // response-content-disposition, so the stub answers as an
            // attachment itself and the assertion is on the URL it was asked.
            await page.route(/amazonaws\.com|cloudfront\.net/, (route) =>
                route.fulfill({
                    status: 200,
                    headers: { 'content-disposition': 'attachment' },
                    body: 'file contents',
                })
            );
            await page.goto(`/s/${liveShare.id}`);

            const downloadStarted = page.waitForEvent('download');
            await page
                .getByRole('button', { name: 'Download notes.txt' })
                .click();
            const url = new URL((await downloadStarted).url());

            const notes = liveShare.files[1]!;
            expect(url.pathname).toContain(`${liveShare.id}/${notes.id}`);
            expect(url.searchParams.get('response-content-disposition')).toBe(
                'attachment; filename="notes.txt"'
            );
        }
    );

    test(
        'a file past its download limit says so instead of downloading',
        { tag: ['@page:/s/[id]', '@uc:share-download-limit'] },
        async ({ page }) => {
            let storageRequests = 0;
            await page.route(/amazonaws\.com|cloudfront\.net/, (route) => {
                storageRequests++;
                return route.abort();
            });
            await page.goto(`/s/${exhaustedShare.id}`);

            await page
                .getByRole('button', { name: 'Download popular.zip' })
                .click();

            await expect(
                page.getByText(/reached its download limit/)
            ).toBeVisible();
            expect(storageRequests).toBe(0);
        }
    );

    test(
        'unknown, unfinished and expired links show a friendly message instead of files',
        { tag: ['@page:/s/[id]', '@uc:share-unavailable-link'] },
        async ({ page }) => {
            const deadLinks = [
                '/s/definitely-not-a-real-link',
                `/s/${unfinishedShare.id}`,
                `/s/${expiredShare.id}`,
            ];

            for (const deadLink of deadLinks) {
                await page.goto(deadLink);
                await expect(
                    page.getByRole('heading', {
                        name: 'This link isn’t available',
                    })
                ).toBeVisible();
                await expect(
                    page.getByRole('button', { name: /^Download/ })
                ).toHaveCount(0);
            }
        }
    );
});
