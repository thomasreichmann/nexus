/**
 * The retrieval-ready email's `?file=` link opens on one request (#546).
 *
 * It took three, one after another: find the file (`files.locate`, batched
 * behind the library's whole first page), then its batch (`getBatch`), then
 * the page of the batch holding it (`listBatchFiles`). From a machine ~125 ms
 * from the dev DB that was ~4 s, and the flows tier's 5 s waits on the same
 * link failed under any extra load.
 *
 * Now `files.locate` answers with the batch and the page too, filed under the
 * requests the pane would make for them. If they weren't filed under exactly
 * those (a folder's key spelled differently, say), the pane would have to ask
 * for them before it could open: so with both requests refused, the viewer
 * coming up is the proof. A timing would say nothing on CI, where the old
 * chain was fast too.
 */
import {
    deleteUserData,
    insertFile,
    insertUploadBatch,
} from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { interceptTrpcCalls } from '../helpers/trpc';

const DEEP_LINK_USER: TestUser = {
    email: 'files-deep-link-e2e@test.local',
    password: 'files-deep-link-e2e-password-123',
    name: 'Files Deep Link E2E',
};
const STATE_PATH = 'e2e/.auth/files-deep-link.json';
const PAGE_URL = '/dashboard/files';

interface LinkedFile {
    id: string;
    name: string;
}

interface Links {
    /** In a batch with no folders. */
    flat: LinkedFile;
    /** In the second folder of a batch with folders. */
    inFolder: LinkedFile;
}

const test = base.extend<NonNullable<unknown>, { links: Links }>({
    links: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const [flatBatch, foldersBatch] = await Promise.all([
                insertUploadBatch(db, { userId, name: 'Flat shoot' }),
                insertUploadBatch(db, { userId, name: 'Shoot with cards' }),
            ]);
            const add = (batchId: string, name: string, subpath?: string) =>
                insertFile(db, { userId, batchId, name, subpath });
            const [flat] = await Promise.all([
                add(flatBatch.id, 'IMG_0002.JPG'),
                add(flatBatch.id, 'IMG_0001.JPG'),
                add(foldersBatch.id, 'A_0001.JPG', '100CANON'),
            ]);
            const inFolder = await add(
                foldersBatch.id,
                'B_0001.JPG',
                '101CANON'
            );

            await use({ flat, inFolder });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({
    dedicatedUserConfig: { user: DEEP_LINK_USER, statePath: STATE_PATH },
});

for (const [label, pick] of [
    ['a flat batch', (links: Links) => links.flat],
    ['a batch with folders', (links: Links) => links.inFolder],
] as const) {
    test(
        `a ?file= link into ${label} opens on one request`,
        { tag: ['@uc:files-deep-link-focus'] },
        async ({ page, links }) => {
            const file = pick(links);
            // The pane still refreshes both once it's up (they're polled, so
            // never fresh), which is fine. It must not need them to open: with
            // them refused, only `locate`'s answer can bring the viewer up.
            await interceptTrpcCalls(page, 'files.getBatch');
            await interceptTrpcCalls(page, 'files.listBatchFiles');

            await page.goto(`${PAGE_URL}?file=${file.id}`);

            await expect(
                page.getByRole('dialog', { name: file.name })
            ).toBeVisible();
        }
    );
}
