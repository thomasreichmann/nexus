import { test as base, expect } from './dedicated-user';
import {
    type UploadBatch,
    type File,
    type Retrieval,
    insertUploadBatch,
    insertFile,
    insertRetrieval,
    deleteUploadBatch,
    deleteFile,
    deleteRetrieval,
    markSubscriptionPaid,
    ensureTrialSubscription,
} from '@nexus/db/test-db';

type DataFixtures = {
    seededBatch: UploadBatch;
    seededFile: File;
    /** A glacier file driven to a ready retrieval — the download-path precondition. */
    readyRetrieval: Retrieval;
    /** Flips the seeded user to a paid Pro sub; resets to trial on teardown. */
    paidSubscription: void;
};

/**
 * Composable precondition fixtures with teardown, seeded for `seedUserId` (the
 * dedicated user in flows specs, the shared user in smoke/admin). Each yields
 * the entity it created and cleans up after the test. Back-door setup: every
 * precondition is established the fastest correct way, never through the UI.
 *
 * Shared-user specs that consume these MUST run serially (or assert nothing
 * exact-count) — parallel specs seeding the same shared user would race. Use a
 * dedicated user for empty-state / exact-count assertions.
 */
export const test = base.extend<DataFixtures>({
    seededBatch: async ({ db, seedUserId }, use) => {
        const batch = await insertUploadBatch(db, { userId: seedUserId });
        await use(batch);
        await deleteUploadBatch(db, batch.id);
    },

    seededFile: async ({ db, seedUserId }, use) => {
        const file = await insertFile(db, { userId: seedUserId });
        await use(file);
        await deleteFile(db, file.id);
    },

    readyRetrieval: async ({ db, seedUserId, seededFile }, use) => {
        const retrieval = await insertRetrieval(db, {
            userId: seedUserId,
            fileId: seededFile.id,
            status: 'ready',
        });
        await use(retrieval);
        await deleteRetrieval(db, retrieval.id);
    },

    paidSubscription: async ({ db, seedUserId }, use) => {
        await markSubscriptionPaid(db, seedUserId, { tier: 'pro' });
        await use();
        await ensureTrialSubscription(db, seedUserId);
    },
});

export { expect };
