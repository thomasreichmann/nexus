import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';

const hoisted = vi.hoisted(() => ({
    send: vi.fn(),
    enqueueJob: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
    const { s3ClientMock } = await import('./testing');
    return { ...actual, S3Client: s3ClientMock(hoisted.send) };
});

vi.mock('./jobs', () => ({ enqueueJob: hoisted.enqueueJob }));

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

    /** The poll's work list comes from a select().from().innerJoin() chain. */
    function givenPending(rows: PendingRow[]) {
        mocks.limit.mockResolvedValue(rows);
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
});
