/**
 * Thumbnail rendering (#350): a batch's card covers itself with its ready
 * thumbnails, files with one show the derived-bucket image in both views,
 * everything else keeps the type-icon fallback, and the viewer shows a
 * video's duration.
 *
 * The derived bucket is synthetic in e2e (playwright.config.ts sets
 * S3_DERIVED_BUCKET): presigning is local HMAC with no AWS round-trip, and
 * this spec fulfills the bucket's image requests with an inline pixel so the
 * <img> elements genuinely load. Runs as a dedicated user so file counts
 * can't race the other flows specs.
 */
import { type File, insertFile, deleteUserData } from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { batchCard, fileItem, openBatch } from '../helpers/fileBrowser';

const THUMBS_USER: TestUser = {
    email: 'file-thumbnails-e2e@test.local',
    password: 'file-thumbnails-e2e-password-123',
    name: 'File Thumbnails E2E',
};
const STATE_PATH = 'e2e/.auth/file-thumbnails.json';
const PAGE_URL = '/dashboard/files';

// Smallest valid image; <img> decoding doesn't care that it's a GIF.
const ONE_PIXEL_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

interface SeededThumbnails {
    readyVideo: File;
    pendingPhoto: File;
}

const test = base.extend<
    NonNullable<unknown>,
    { seededThumbnails: SeededThumbnails }
>({
    seededThumbnails: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const readyVideo = await insertFile(db, {
                userId,
                name: 'ceremony-highlights.mp4',
                size: 4_000_000,
                status: 'available',
                thumbnailStatus: 'ready',
                thumbnailWidth: 512,
                thumbnailHeight: 288,
                durationSeconds: 42,
            });
            const pendingPhoto = await insertFile(db, {
                userId,
                name: 'processing-photo.nef',
                size: 2_000_000,
                status: 'available',
                thumbnailStatus: 'pending',
            });

            await use({ readyVideo, pendingPhoto });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({ dedicatedUserConfig: { user: THUMBS_USER, statePath: STATE_PATH } });

test(
    'ready thumbnails render on the cover and in grid and list; pending keeps the icon fallback',
    { tag: ['@page:/dashboard/files', '@uc:files-thumbnails'] },
    async ({ page, seededThumbnails, consoleErrors }) => {
        // Serve the derived bucket's presigned GETs locally so images load.
        await page.route('**e2e-derived-bucket**', (route) =>
            route.fulfill({ body: ONE_PIXEL_GIF, contentType: 'image/gif' })
        );
        const { readyVideo, pendingPhoto } = seededThumbnails;

        // The batch's card covers itself with the thumbnail it has.
        await page.goto(PAGE_URL);
        const card = batchCard(page, 'Ungrouped');
        await expect(
            card.locator('img[src*="e2e-derived-bucket"]')
        ).toHaveCount(1);

        // Grid (the default): the tile carries the presigned image. No
        // ready thumbnail -> no <img>; the type icon keeps the tile.
        await openBatch(page, 'Ungrouped');
        await expect(
            fileItem(page, readyVideo.name).locator(
                'img[src*="e2e-derived-bucket"]'
            )
        ).toBeVisible();
        await expect(
            fileItem(page, pendingPhoto.name).locator('img')
        ).toHaveCount(0);

        // List view: the same, in the row's icon tile.
        await page.getByRole('button', { name: 'List view' }).click();
        await expect(
            fileItem(page, readyVideo.name).locator(
                'img[src*="e2e-derived-bucket"]'
            )
        ).toBeVisible();
        await expect(
            fileItem(page, pendingPhoto.name).locator('img')
        ).toHaveCount(0);

        // The viewer: the video's duration, on the photo and in its details.
        await fileItem(page, readyVideo.name)
            .getByRole('button', { name: readyVideo.name })
            .click();
        const viewer = page.getByRole('dialog', { name: readyVideo.name });
        await expect(viewer.getByText('0:42').first()).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);
