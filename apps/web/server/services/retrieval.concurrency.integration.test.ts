import { vi } from 'vitest';
import { it, describe, expect } from '@nexus/db/test-db/integration';
import { insertFile, type DB } from '@nexus/db/test-db';

// Two requests for one file only collide if both read "no active row" before
// either inserts. Left to Promise.all they rarely do: the second read usually
// sees the first's row and takes the already-covered exit, so the ON CONFLICT
// path and the loser's adoption of the winner's row never run (#490). A
// two-party barrier after the read forces the collision every time.
const barriers = vi.hoisted(() => new Map<string, () => Promise<void>>());

/** The next two reads covering `fileId` each wait for the other before returning. */
function holdReadsUntilBothArrive(fileId: string): void {
    let arrived = 0;
    let release!: () => void;
    let fail!: (error: Error) => void;
    const bothArrived = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
    });
    const timeout = setTimeout(() => {
        barriers.delete(fileId);
        fail(
            new Error(
                'Only one request reached the retrieval read: the request path no longer calls findByFileIds before inserting, so this barrier needs moving.'
            )
        );
    }, 5_000);

    barriers.set(fileId, () => {
        arrived += 1;
        if (arrived === 2) {
            clearTimeout(timeout);
            // Disarmed, so the loser's adoption lookup goes straight through.
            barriers.delete(fileId);
            release();
        }
        return bothArrived;
    });
}

vi.mock('@nexus/db/repo/retrievals', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@nexus/db/repo/retrievals')>();
    return {
        ...actual,
        createRetrievalRepo: (db: DB) => {
            const repo = actual.createRetrievalRepo(db);
            return {
                ...repo,
                findByFileIds: async (fileIds: string[]) => {
                    const rows = await repo.findByFileIds(fileIds);
                    const barrier = fileIds
                        .map((id) => barriers.get(id))
                        .find(Boolean);
                    await barrier?.();
                    return rows;
                },
            };
        },
    };
});

// Only what leaves the process is faked. The request path asks S3 nothing
// (#423), so any S3 call here fails the test.
const jobMocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ jobs: { publish: jobMocks.publish } }));
vi.mock('@/lib/storage', () => ({ s3: {} }));

import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { retrievalService } from './retrieval';

// Sequential, unlike retrieval.integration.test.ts: this file asserts on the
// publish mock's calls.
describe('one active retrieval per file (#266)', () => {
    it('two requests that both miss the active row share the one the winner inserts', async ({
        db,
        user,
    }) => {
        const file = await insertFile(db, { userId: user.id });
        holdReadsUntilBothArrive(file.id);

        const [first, second] = await Promise.all([
            retrievalService.requestRetrieval(db, user.id, file.id),
            retrievalService.requestRetrieval(db, user.id, file.id),
        ]);

        // Both took the insert path: the already-covered exit publishes nothing.
        expect(jobMocks.publish).toHaveBeenCalledTimes(2);

        const active = await createRetrievalRepo(db).findByFileIds([file.id]);
        expect(active).toHaveLength(1);

        // The loser adopted the winner's row, so each request's item points
        // at it and each request's initiate-restore job sees the file.
        const requestRepo = createRetrievalRequestRepo(db);
        const pendingRowIds = async (requestId: string) =>
            (await requestRepo.findPendingRetrievals(requestId)).map(
                (r) => r.retrievalId
            );
        expect(await pendingRowIds(first.requestId)).toEqual([active[0].id]);
        expect(await pendingRowIds(second.requestId)).toEqual([active[0].id]);
    });
});
