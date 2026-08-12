/**
 * Thumbnail rendering (#350): files with a ready thumbnail show the
 * derived-bucket image in both views, everything else keeps the type-icon
 * fallback, and video cards carry a duration badge.
 *
 * The derived bucket is synthetic in e2e (playwright.config.ts sets
 * S3_DERIVED_BUCKET): presigning is local HMAC with no AWS round-trip, and
 * this spec fulfills the bucket's image requests with an inline pixel so the
 * <img> elements genuinely load. Runs as a dedicated user so file counts
 * can't race the other flows specs.
 */
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { type File, insertFile, deleteUserData } from '@nexus/db/test-db';
import { fileName } from '../helpers/table';

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
                storageTier: 'deep_archive',
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
                storageTier: 'standard',
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
    'ready thumbnails render in list and grid; pending keeps the icon fallback',
    { tag: ['@page:/dashboard/files', '@uc:files-thumbnails'] },
    async ({ page, seededThumbnails, consoleErrors }) => {
        // Serve the derived bucket's presigned GETs locally so images load.
        await page.route('**e2e-derived-bucket**', (route) =>
            route.fulfill({ body: ONE_PIXEL_GIF, contentType: 'image/gif' })
        );

        await page.goto(PAGE_URL);
        await expect(
            fileName(page, seededThumbnails.readyVideo.name)
        ).toBeVisible();

        // List view (default): the icon tile carries the presigned image.
        await expect(
            page
                .getByRole('row', { name: seededThumbnails.readyVideo.name })
                .locator('img[src*="e2e-derived-bucket"]')
        ).toBeVisible();
        // No ready thumbnail -> no <img>; the type icon keeps the tile.
        await expect(
            page
                .getByRole('row', { name: seededThumbnails.pendingPhoto.name })
                .locator('img')
        ).toHaveCount(0);

        // Grid view: media-box image plus the video duration badge.
        await page.getByRole('button', { name: 'Grid view' }).click();
        await expect(
            page.locator('img[src*="e2e-derived-bucket"]').first()
        ).toBeVisible();
        await expect(page.getByText('0:42')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);
