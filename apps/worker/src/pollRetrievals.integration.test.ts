import { vi } from 'vitest';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import {
    insertFile,
    insertRetrievalRequest,
    insertRetrievalRequestItem,
    insertUploadBatch,
} from '@nexus/db/test-db';
import { describe, expect, it } from '@nexus/db/test-db/integration';

// The one thing here that leaves the process: each part's build job is an SQS
// publish.
const hoisted = vi.hoisted(() => ({ enqueueJob: vi.fn() }));
vi.mock('./jobs', () => ({ enqueueJob: hoisted.enqueueJob }));

import { MAX_CHUNK_BYTES } from './partition';
import { startZipBuild } from './pollRetrievals';

describe('startZipBuild', () => {
    // #452: two cards' worth of IMG_0001.JPG split across two zips. Each part
    // alone holds one of them, so only the partition, which sees both parts,
    // can tell them apart; extracted into one folder they must not collide.
    it('names same-named files in different parts apart', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const [request, batch] = await Promise.all([
            insertRetrievalRequest(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        // Over half the cap each, so no part can hold both.
        const size = MAX_CHUNK_BYTES / 2 + 1;
        const files = await Promise.all(
            [0, 1].map(() =>
                insertFile(db, {
                    userId: user.id,
                    batchId: batch.id,
                    name: 'IMG_0001.JPG',
                    size,
                })
            )
        );
        await Promise.all(
            files.map((file) =>
                insertRetrievalRequestItem(db, {
                    requestId: request.id,
                    fileId: file.id,
                })
            )
        );

        await startZipBuild(db, repo, request.id);

        const parts = await repo.findArtifacts(request.id);
        const namesByPart = await Promise.all(
            parts.map(async (part) =>
                (await repo.findArtifactFiles(part.id)).map(
                    (file) => file.entryName
                )
            )
        );
        expect(namesByPart).toHaveLength(2);
        expect(namesByPart.flat().sort()).toEqual([
            'IMG_0001 (2).JPG',
            'IMG_0001.JPG',
        ]);
    });
});
