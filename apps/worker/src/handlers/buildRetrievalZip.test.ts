import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    createRetrievalArtifactFixture,
    createRetrievalRequestFileFixture,
    type MockDb,
    type MockDbMocks,
} from '@nexus/db/testing';
import * as schema from '@nexus/db/schema';

const hoisted = vi.hoisted(() => ({
    createZipStream: vi.fn(),
    uploadStreamMultipart: vi.fn(),
    sendRetrievalRequestReadyEmail: vi.fn(),
    captureWorkerEvent: vi.fn(),
}));

vi.mock('../zipStream', () => ({ createZipStream: hoisted.createZipStream }));
vi.mock('../multipartUpload', () => ({
    uploadStreamMultipart: hoisted.uploadStreamMultipart,
}));
vi.mock('../email', () => ({
    sendRetrievalRequestReadyEmail: hoisted.sendRetrievalRequestReadyEmail,
}));
vi.mock('../analytics', () => ({
    captureWorkerEvent: hoisted.captureWorkerEvent,
}));

import { buildRetrievalZip } from './buildRetrievalZip';
import type { RetrievalArtifact } from '@nexus/db/repo/retrievalRequests';

const ARTIFACT_ID = 'artifact-1';
const REQUEST_ID = 'request-1';

function artifact(
    overrides: Partial<RetrievalArtifact> = {}
): RetrievalArtifact {
    return createRetrievalArtifactFixture({
        id: ARTIFACT_ID,
        requestId: REQUEST_ID,
        ...overrides,
    });
}

const FILES = [
    createRetrievalRequestFileFixture({
        fileId: 'file-1',
        s3Key: 'user-1/batch/file-1/a.cr2',
        name: 'a.cr2',
    }),
];

describe('buildRetrievalZip', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.S3_BUCKET = 'files-bucket';
        process.env.S3_RETRIEVAL_ARTIFACTS_BUCKET = 'artifacts-bucket';

        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;

        hoisted.uploadStreamMultipart.mockResolvedValue({ sizeBytes: 4096 });
        // findArtifactFiles ends its innerJoin chain at .orderBy().
        mocks.innerJoinOrderByRows.mockResolvedValue(FILES);
        mocks.retrievalRequests.findFirst.mockResolvedValue({
            id: REQUEST_ID,
            userId: 'user-1',
        });
    });

    function run() {
        return buildRetrievalZip({
            jobId: 'job-1',
            payload: { artifactId: ARTIFACT_ID },
            db,
        });
    }

    /** claimArtifact and completeIfDeliverable both end at .returning(). */
    function givenUpdatesReturn(...rows: unknown[][]) {
        for (const row of rows) mocks.returning.mockResolvedValueOnce(row);
    }

    it('builds the zip and records the artifact as ready', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(artifact());
        givenUpdatesReturn([artifact({ status: 'building' })]);

        await run();

        expect(hoisted.createZipStream).toHaveBeenCalledWith(
            'files-bucket',
            FILES
        );
        const [bucket, key] = hoisted.uploadStreamMultipart.mock.calls[0];
        expect(bucket).toBe('artifacts-bucket');
        expect(key).toBe(
            `user-1/${REQUEST_ID}/${ARTIFACT_ID}/nexus-part-1.zip`
        );

        const completion = mocks.set.mock.calls.find(
            ([values]) => (values as { s3Key?: string }).s3Key
        );
        expect(completion?.[0]).toMatchObject({
            status: 'ready',
            s3Key: key,
            sizeBytes: 4096,
        });
    });

    // The request was deleted between enqueue and delivery. Parking this on the
    // DLQ would page a human to discover there is no work behind it.
    it('drops the job when the artifact no longer exists', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(undefined);

        await run();

        expect(hoisted.uploadStreamMultipart).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    // A duplicate delivery must not re-run a 4GB upload, but must still settle
    // the request: the first delivery may have died between the two writes.
    it('skips a rebuild but re-checks completion when already ready', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(
            artifact({ status: 'ready', s3Key: 'existing.zip' })
        );

        await run();

        expect(hoisted.uploadStreamMultipart).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(schema.retrievalRequests);
    });

    it('marks the artifact failed and rethrows when the upload fails', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(artifact());
        givenUpdatesReturn([artifact({ status: 'building' })]);
        hoisted.uploadStreamMultipart.mockRejectedValue(
            new Error('S3 exploded')
        );

        await expect(run()).rejects.toThrow('S3 exploded');

        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'S3 exploded',
            })
        );
    });

    it('fails loudly when the partition assigned no files', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(artifact());
        givenUpdatesReturn([artifact({ status: 'building' })]);
        mocks.innerJoinOrderByRows.mockResolvedValue([]);

        await expect(run()).rejects.toThrow(/no files assigned/);
        expect(hoisted.uploadStreamMultipart).not.toHaveBeenCalled();
    });

    it('numbers the zip from the artifact position', async () => {
        mocks.retrievalArtifacts.findFirst.mockResolvedValue(
            artifact({ position: 3 })
        );
        givenUpdatesReturn([artifact({ position: 3, status: 'building' })]);

        await run();

        expect(hoisted.uploadStreamMultipart.mock.calls[0][1]).toContain(
            'nexus-part-4.zip'
        );
    });

    // The winner of the completed_at election is the only job that announces,
    // which is what makes it one email and one event per request (#426).
    describe('announcing a completed request', () => {
        const BUILT_AT = new Date('2026-08-30T10:00:00Z');
        const COMPLETED_REQUEST = {
            id: REQUEST_ID,
            userId: 'user-1',
            tier: 'bulk',
            completedAt: new Date('2026-08-30T10:05:00Z'),
        };

        function givenRequestCompletes() {
            mocks.retrievalArtifacts.findFirst.mockResolvedValue(artifact());
            // claimArtifact, completeArtifact, then the completion election.
            givenUpdatesReturn(
                [artifact({ status: 'building' })],
                [artifact({ status: 'ready' })],
                [COMPLETED_REQUEST]
            );
            mocks.retrievalArtifacts.findMany.mockResolvedValue([
                artifact({
                    sizeBytes: 3_000,
                    startedAt: new Date('2026-08-30T09:58:00Z'),
                    completedAt: BUILT_AT,
                }),
                artifact({
                    id: 'artifact-2',
                    position: 1,
                    sizeBytes: 1_000,
                    startedAt: new Date('2026-08-30T09:59:00Z'),
                    completedAt: new Date('2026-08-30T10:01:00Z'),
                }),
            ]);
            // findTimings' aggregate row.
            mocks.leftJoinRows.mockResolvedValue([
                {
                    fileCount: 12,
                    initiatedAt: new Date('2026-08-29T10:00:00Z'),
                    readyAt: new Date('2026-08-30T09:00:00Z'),
                },
            ]);
        }

        it('sends one email with the artifacts own expiry window', async () => {
            givenRequestCompletes();

            await run();

            expect(
                hoisted.sendRetrievalRequestReadyEmail
            ).toHaveBeenCalledTimes(1);
            const [, opts] =
                hoisted.sendRetrievalRequestReadyEmail.mock.calls[0];
            expect(opts).toMatchObject({
                userId: 'user-1',
                requestId: REQUEST_ID,
                fileCount: 12,
                partCount: 2,
                totalBytes: 4_000,
            });
            // Seven days from the EARLIEST artifact — the reader needs every
            // part, so the first one to lapse ends the window.
            expect(opts.expiresAt).toEqual(new Date('2026-09-06T10:00:00Z'));
        });

        it('captures the ready event with the thaw and build spans apart', async () => {
            givenRequestCompletes();

            await run();

            expect(hoisted.captureWorkerEvent).toHaveBeenCalledWith(
                'user-1',
                'retrieval_ready',
                expect.objectContaining({
                    requestId: REQUEST_ID,
                    tier: 'bulk',
                    fileCount: 12,
                    partCount: 2,
                    totalBytes: 4_000,
                    thawSeconds: 82_800,
                    buildSeconds: 180,
                })
            );
        });

        // The completion write already landed; a Resend or PostHog outage must
        // not re-queue a build that succeeded.
        it('swallows an announcement failure', async () => {
            givenRequestCompletes();
            hoisted.sendRetrievalRequestReadyEmail.mockRejectedValue(
                new Error('Resend is down')
            );

            await expect(run()).resolves.toBeUndefined();
        });

        it('announces nothing when another job won the election', async () => {
            mocks.retrievalArtifacts.findFirst.mockResolvedValue(artifact());
            givenUpdatesReturn(
                [artifact({ status: 'building' })],
                [artifact({ status: 'ready' })],
                [] // no row came back: a sibling artifact is still building
            );

            await run();

            expect(
                hoisted.sendRetrievalRequestReadyEmail
            ).not.toHaveBeenCalled();
            expect(hoisted.captureWorkerEvent).not.toHaveBeenCalled();
        });
    });
});
