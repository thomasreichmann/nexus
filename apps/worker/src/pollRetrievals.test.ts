import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '@nexus/db/schema';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';

const hoisted = vi.hoisted(() => ({
    send: vi.fn(),
    enqueueJob: vi.fn(),
    sendRetrievalFileReadyEmail: vi.fn(),
    captureWorkerEvent: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
    const { s3ClientMock } = await import('./testing');
    return { ...actual, S3Client: s3ClientMock(hoisted.send) };
});

vi.mock('./jobs', () => ({ enqueueJob: hoisted.enqueueJob }));
vi.mock('./email', () => ({
    sendRetrievalFileReadyEmail: hoisted.sendRetrievalFileReadyEmail,
}));
vi.mock('./analytics', () => ({
    captureWorkerEvent: hoisted.captureWorkerEvent,
}));

import { pollRetrievals } from './pollRetrievals';
import { notFound, RESTORED, STILL_ARCHIVED } from './testing';

interface PendingRow {
    id: string;
    fileId: string;
    userId: string;
    initiatedAt: Date | null;
    fileName: string;
    s3Key: string;
    thumbnailStatus: string;
}

function pendingRow(overrides: Partial<PendingRow> = {}): PendingRow {
    return {
        id: 'ret-1',
        fileId: 'file-1',
        userId: 'user-1',
        initiatedAt: new Date(),
        fileName: 'shoot.cr2',
        s3Key: 'user-1/file-1',
        thumbnailStatus: 'ready',
        ...overrides,
    };
}

describe('pollRetrievals', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.S3_BUCKET = 'test-bucket';
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    /**
     * The poll's work list comes from a select().from().innerJoin() chain.
     * `Once`, because the direct-delivery scan ends at the same `.limit()`
     * terminal and runs second — with a plain mockResolvedValue it would be
     * handed these pending-shaped rows instead of falling back to [].
     */
    function givenPending(rows: PendingRow[]) {
        mocks.limit.mockResolvedValueOnce(rows);
    }

    it('marks a restored retrieval ready with the expiry S3 reported', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(RESTORED);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 1, ready: 1, waiting: 0 });
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'ready',
                readyAt: expect.any(Date),
                expiresAt: new Date('Fri, 29 Aug 2026 00:00:00 GMT'),
            })
        );
    });

    it('leaves a still-archived retrieval pending', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 1, ready: 0, waiting: 1 });
        expect(mocks.set).not.toHaveBeenCalled();
    });

    // The whole point of the redesign: work is bounded by our own pending set,
    // so K rows must produce exactly K HEADs and nothing else.
    it('issues exactly one HeadObject per pending row', async () => {
        givenPending([
            pendingRow({ id: 'r1', s3Key: 'k1' }),
            pendingRow({ id: 'r2', s3Key: 'k2' }),
            pendingRow({ id: 'r3', s3Key: 'k3' }),
        ]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        const summary = await pollRetrievals(db);

        expect(hoisted.send).toHaveBeenCalledTimes(3);
        expect(summary.checked).toBe(3);
    });

    it('re-enqueues a thumbnail that failed while its original was cold', async () => {
        givenPending([pendingRow({ thumbnailStatus: 'failed_cold' })]);
        hoisted.send.mockResolvedValue(RESTORED);

        await pollRetrievals(db);

        expect(hoisted.enqueueJob).toHaveBeenCalledWith(db, {
            type: 'generate-thumbnail',
            payload: { fileId: 'file-1' },
        });
    });

    it('does not re-enqueue a thumbnail that is already ready', async () => {
        givenPending([pendingRow({ thumbnailStatus: 'ready' })]);
        hoisted.send.mockResolvedValue(RESTORED);

        await pollRetrievals(db);

        expect(hoisted.enqueueJob).not.toHaveBeenCalled();
    });

    // One bad key must not strand the rest of the batch — the next run retries
    // it, and the 48h stuck-retrieval check escalates if it never clears.
    it('counts a failed HEAD and keeps going', async () => {
        givenPending([
            pendingRow({ id: 'r1', s3Key: 'broken' }),
            pendingRow({ id: 'r2', s3Key: 'here' }),
        ]);
        hoisted.send
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(RESTORED);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 2, ready: 1, errored: 1 });
    });

    // Nothing will ever restore an object that isn't there, so the row is
    // settled rather than re-HEADed every 15 minutes until the 48h check.
    it('fails a retrieval whose object is gone from the bucket', async () => {
        givenPending([pendingRow({ s3Key: 'gone' })]);
        hoisted.send.mockRejectedValue(notFound());

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 1, missing: 1, errored: 0 });
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                failedAt: expect.any(Date),
                errorMessage: 'Object no longer exists in S3',
            })
        );
    });

    // A missing object is a settled answer, so it must not read as a total
    // outage — otherwise one deleted file would alarm forever.
    it('does not throw when every row is merely missing', async () => {
        givenPending([pendingRow({ id: 'r1' }), pendingRow({ id: 'r2' })]);
        hoisted.send.mockRejectedValue(notFound());

        await expect(pollRetrievals(db)).resolves.toMatchObject({
            checked: 2,
            missing: 2,
        });
    });

    // The scheduled path has no DLQ: `nexus-worker-errors` watches the Lambda
    // Errors metric, which only ever sees a whole-invocation throw. Swallowing
    // a total S3/IAM failure would leave that alarm green through the exact
    // outage it exists to catch.
    it('throws when every row errors, so the Lambda error metric sees it', async () => {
        givenPending([pendingRow({ id: 'r1' }), pendingRow({ id: 'r2' })]);
        hoisted.send.mockRejectedValue(new Error('AccessDenied'));

        await expect(pollRetrievals(db)).rejects.toThrow(
            'failed for all 2 pending rows'
        );
    });

    it('does not throw when at least one row succeeds', async () => {
        givenPending([
            pendingRow({ id: 'r1', s3Key: 'broken' }),
            pendingRow({ id: 'r2', s3Key: 'here' }),
        ]);
        hoisted.send
            .mockRejectedValueOnce(new Error('AccessDenied'))
            .mockResolvedValueOnce(STILL_ARCHIVED);

        await expect(pollRetrievals(db)).resolves.toMatchObject({
            errored: 1,
            waiting: 1,
        });
    });

    it('reports nothing to do on an empty pending set', async () => {
        givenPending([]);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 0, ready: 0, capped: false });
        expect(hoisted.send).not.toHaveBeenCalled();
    });

    // The horizon means a run's budget is spent only on rows that could
    // actually be done, which is what lets the cap be a full-archive number
    // instead of the old 400. The predicate itself is SQL, exercised against a
    // real database in apps/web's retrieval.integration.test.ts.
    it('asks for a full-archive-sized page of due rows', async () => {
        givenPending([]);

        await pollRetrievals(db);

        // One past the cap, purely so overflow is detectable.
        expect(mocks.limit).toHaveBeenCalledWith(5001);
    });

    // The two halves of #423's poll rule: S3 in parallel, the database strictly
    // one query at a time, so a 5,000-row run can't open a second pooler
    // connection.
    it('runs its HEADs concurrently and its writes serially', async () => {
        givenPending([
            pendingRow({ id: 'r1', s3Key: 'k1' }),
            pendingRow({ id: 'r2', s3Key: 'k2' }),
            pendingRow({ id: 'r3', s3Key: 'k3' }),
        ]);

        let headsInFlight = 0;
        let peakHeads = 0;
        hoisted.send.mockImplementation(async () => {
            headsInFlight++;
            peakHeads = Math.max(peakHeads, headsInFlight);
            await new Promise((resolve) => setTimeout(resolve, 0));
            headsInFlight--;
            return RESTORED;
        });

        // `updateStatus` ends at `.returning()`, so that is the write terminal.
        let writesInFlight = 0;
        let peakWrites = 0;
        mocks.returning.mockImplementation(async () => {
            writesInFlight++;
            peakWrites = Math.max(peakWrites, writesInFlight);
            await new Promise((resolve) => setTimeout(resolve, 0));
            writesInFlight--;
            return [];
        });

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 3, ready: 3 });
        expect(peakHeads).toBeGreaterThan(1);
        expect(peakWrites).toBe(1);
    });

    // Every row is asked about before any row is written, so a write that
    // throws leaves the row pending for the next run rather than reporting it
    // as settled.
    it('counts a failed status write as errored, not ready', async () => {
        givenPending([
            pendingRow({ id: 'r1', s3Key: 'k1' }),
            pendingRow({ id: 'r2', s3Key: 'k2' }),
        ]);
        hoisted.send.mockResolvedValue(RESTORED);
        mocks.returning.mockRejectedValueOnce(new Error('db connection lost'));

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 2, ready: 1, errored: 1 });
    });

    // The zip trigger is a reconciling scan, not a reaction to this run's
    // flips: a retrieval that goes `ready` leaves the pending work list for
    // good, so anything keyed to "what changed this run" could never retry.
    describe('zip build trigger', () => {
        /** findBuildable ends at its own .limit(), separate from the poll's. */
        function givenBuildable(requestIds: string[]) {
            mocks.whereLimit.mockResolvedValue(
                requestIds.map((id) => ({ id }))
            );
        }

        function givenFiles(files: { fileId: string; size: number }[]): void {
            mocks.innerJoinOrderByRows.mockResolvedValue(
                files.map((f) => ({
                    ...f,
                    s3Key: `key/${f.fileId}`,
                    name: `${f.fileId}.cr2`,
                    createdAt: new Date(),
                }))
            );
        }

        function artifact(id: string, position: number, status = 'pending') {
            return { id, position, status, requestId: 'req-1' };
        }

        /** findArtifacts answers both the "partitioned yet?" and enqueue reads. */
        function givenArtifacts(rows: ReturnType<typeof artifact>[]) {
            mocks.retrievalArtifacts.findMany.mockResolvedValue(rows);
            mocks.returning.mockResolvedValue(rows);
        }

        it('partitions a ready request and enqueues one job per chunk', async () => {
            givenPending([]);
            givenBuildable(['req-1']);
            givenFiles([
                { fileId: 'f1', size: 3_000_000_000 },
                { fileId: 'f2', size: 3_000_000_000 },
            ]);
            const chunks = [artifact('a1', 0), artifact('a2', 1)];
            // Empty before the partition, both chunks after it.
            mocks.retrievalArtifacts.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(chunks);
            mocks.returning.mockResolvedValue(chunks);

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                requestsPartitioned: 1,
                zipJobsEnqueued: 2,
                zipErrored: 0,
            });
            expect(hoisted.enqueueJob).toHaveBeenCalledWith(db, {
                type: 'build-retrieval-zip',
                payload: { artifactId: 'a1' },
            });
            expect(hoisted.enqueueJob).toHaveBeenCalledWith(db, {
                type: 'build-retrieval-zip',
                payload: { artifactId: 'a2' },
            });
        });

        // The crash-mid-enqueue case: the artifacts exist, so the insert
        // conflicts away and returns nothing, but the jobs were never sent.
        it('re-enqueues artifacts a previous run wrote but never published', async () => {
            givenPending([]);
            givenBuildable(['req-1']);
            givenArtifacts([artifact('a1', 0)]);

            const summary = await pollRetrievals(db);

            expect(summary.zipJobsEnqueued).toBe(1);
            // No partition: the existing artifacts short-circuit it.
            expect(mocks.countInsertsInto(schema.retrievalArtifacts)).toBe(0);
        });

        // findBuildable keeps offering a request until it completes, so the
        // partition must be keyed on "has artifacts", not "has pending ones".
        it('leaves a request whose chunks are mid-build alone', async () => {
            givenPending([]);
            givenBuildable(['req-1']);
            givenArtifacts([
                artifact('a1', 0, 'ready'),
                artifact('a2', 1, 'building'),
            ]);

            const summary = await pollRetrievals(db);

            expect(summary.zipJobsEnqueued).toBe(0);
            expect(hoisted.enqueueJob).not.toHaveBeenCalled();
            expect(mocks.countInsertsInto(schema.retrievalArtifacts)).toBe(0);
        });

        it('does nothing when no request is ready to build', async () => {
            givenPending([]);
            givenBuildable([]);

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                requestsPartitioned: 0,
                zipJobsEnqueued: 0,
            });
            expect(hoisted.enqueueJob).not.toHaveBeenCalled();
        });

        // The retrievals this run flipped are correctly `ready` either way, and
        // findBuildable re-offers the request next run — so a zip failure costs
        // 15 minutes rather than the whole invocation.
        it('counts a failed request without failing the poll', async () => {
            givenPending([]);
            givenBuildable(['req-1', 'req-2']);
            givenArtifacts([artifact('a1', 0)]);
            hoisted.enqueueJob
                .mockRejectedValueOnce(new Error('SQS unavailable'))
                .mockResolvedValue({ id: 'job-1' });

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                zipErrored: 1,
                // Neither request needed partitioning — both already had
                // artifacts, so only the enqueue ran.
                requestsPartitioned: 0,
                zipJobsEnqueued: 1,
            });
        });

        // No request was even named, so counting it as one failed request
        // would misreport the scale in the line an operator reads.
        it('flags a failed lookup separately from a failed request', async () => {
            givenPending([]);
            mocks.whereLimit.mockRejectedValue(new Error('pooler down'));

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                zipLookupFailed: true,
                zipErrored: 0,
                requestsPartitioned: 0,
            });
        });
    });

    // The direct-delivery trigger is the same reconciling shape as the zip one,
    // with one extra reason: a warm object is settled by initiateRestore's
    // short-circuit and never enters this poll's work list, so only a scan of
    // "what is deliverable and not complete?" can ever announce it.
    describe('direct delivery trigger', () => {
        interface DeliverableRow {
            requestId: string;
            userId: string;
            fileId: string;
            fileName: string;
            fileSize: number;
            expiresAt: Date | null;
            initiatedAt: Date | null;
            readyAt: Date | null;
        }

        function deliverableRow(
            overrides: Partial<DeliverableRow> = {}
        ): DeliverableRow {
            return {
                requestId: 'req-1',
                userId: 'user-1',
                fileId: 'file-1',
                fileName: 'shoot.cr2',
                fileSize: 2_000_000,
                expiresAt: new Date('2026-09-06T10:00:00Z'),
                initiatedAt: new Date('2026-08-29T10:00:00Z'),
                readyAt: new Date('2026-08-29T16:00:00Z'),
                ...overrides,
            };
        }

        /**
         * The scan shares the innerJoin family's `.limit()` terminal with the
         * poll's work list, which is fetched first — so queue an empty work
         * list ahead of the scan's rows rather than calling givenPending.
         */
        function givenDeliverable(rows: DeliverableRow[]) {
            mocks.limit.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
        }

        /** completeIfDeliverable's winning UPDATE ends at `.returning()`. */
        function givenElectionWon() {
            mocks.returning.mockResolvedValueOnce([
                { id: 'req-1', userId: 'user-1', tier: 'bulk' },
            ]);
        }

        it('completes a deliverable single-file request and announces it', async () => {
            givenDeliverable([deliverableRow()]);
            givenElectionWon();

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                directCompleted: 1,
                directErrored: 0,
            });
            expect(mocks.set).toHaveBeenCalledWith({
                completedAt: expect.any(Date),
            });
            expect(hoisted.sendRetrievalFileReadyEmail).toHaveBeenCalledWith(
                db,
                {
                    userId: 'user-1',
                    requestId: 'req-1',
                    fileId: 'file-1',
                    fileName: 'shoot.cr2',
                    expiresAt: new Date('2026-09-06T10:00:00Z'),
                }
            );
        });

        // The AC's documented shape split: one `retrieval_ready` funnel across
        // both delivery shapes, where partCount/buildSeconds existing at all
        // means "zip" — so here they must be absent, not zero or null.
        it('captures one retrieval_ready event shaped for direct delivery', async () => {
            givenDeliverable([deliverableRow()]);
            givenElectionWon();

            await pollRetrievals(db);

            expect(hoisted.captureWorkerEvent).toHaveBeenCalledTimes(1);
            const [userId, event, props] =
                hoisted.captureWorkerEvent.mock.calls[0];
            expect(userId).toBe('user-1');
            expect(event).toBe('retrieval_ready');
            expect(props).toMatchObject({
                requestId: 'req-1',
                tier: 'bulk',
                fileCount: 1,
                totalBytes: 2_000_000,
                thawSeconds: 6 * 60 * 60,
            });
            expect(props).not.toHaveProperty('partCount');
            expect(props).not.toHaveProperty('buildSeconds');
        });

        // The winning UPDATE elects the single sender: an empty RETURNING
        // means another writer already completed the request (or readiness
        // lapsed since the scan), and this run must stay silent.
        it('announces nothing when the completion election is lost', async () => {
            givenDeliverable([deliverableRow()]);
            // mocks.returning defaults to [] — the lost election.

            const summary = await pollRetrievals(db);

            expect(summary.directCompleted).toBe(0);
            expect(hoisted.sendRetrievalFileReadyEmail).not.toHaveBeenCalled();
            expect(hoisted.captureWorkerEvent).not.toHaveBeenCalled();
        });

        // The announcement runs after the winning UPDATE and must not undo it:
        // the file is downloadable whether or not Resend answers.
        it('warns and swallows a failed announcement, keeping the completion', async () => {
            givenDeliverable([deliverableRow()]);
            givenElectionWon();
            hoisted.sendRetrievalFileReadyEmail.mockRejectedValue(
                new Error('Resend is down')
            );

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                directCompleted: 1,
                directErrored: 0,
            });
        });

        it('counts a failed completion write without failing the poll', async () => {
            givenDeliverable([
                deliverableRow({ requestId: 'req-1' }),
                deliverableRow({ requestId: 'req-2' }),
            ]);
            mocks.returning
                .mockRejectedValueOnce(new Error('pooler down'))
                .mockResolvedValueOnce([
                    { id: 'req-2', userId: 'user-1', tier: 'bulk' },
                ]);

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                directCompleted: 1,
                directErrored: 1,
            });
        });

        it('flags a failed lookup separately from a failed request', async () => {
            givenPending([]);
            mocks.limit.mockRejectedValueOnce(new Error('pooler down'));

            const summary = await pollRetrievals(db);

            expect(summary).toMatchObject({
                directLookupFailed: true,
                directErrored: 0,
                directCompleted: 0,
            });
        });
    });
});
