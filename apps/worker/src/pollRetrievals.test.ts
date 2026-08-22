import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';

const hoisted = vi.hoisted(() => ({
    send: vi.fn(),
    enqueueJob: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
    return {
        ...actual,
        S3Client: class {
            send = hoisted.send;
        },
    };
});

vi.mock('./jobs', () => ({ enqueueJob: hoisted.enqueueJob }));

import { pollRetrievals } from './pollRetrievals';

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

/** The HeadObject fields the poll reads. */
function headResponse(
    storageClass?: string,
    restore?: string
): { StorageClass?: string; Restore?: string } {
    return { StorageClass: storageClass, Restore: restore };
}

const RESTORED = headResponse(
    'DEEP_ARCHIVE',
    'ongoing-request="false", expiry-date="Fri, 29 Aug 2026 00:00:00 GMT"'
);
const STILL_ARCHIVED = headResponse('DEEP_ARCHIVE');

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
            pendingRow({ id: 'r1', s3Key: 'gone' }),
            pendingRow({ id: 'r2', s3Key: 'here' }),
        ]);
        hoisted.send
            .mockRejectedValueOnce(new Error('NoSuchKey'))
            .mockResolvedValueOnce(RESTORED);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 2, ready: 1, errored: 1 });
    });

    it('reports nothing to do on an empty pending set', async () => {
        givenPending([]);

        const summary = await pollRetrievals(db);

        expect(summary).toMatchObject({ checked: 0, ready: 0, capped: false });
        expect(hoisted.send).not.toHaveBeenCalled();
    });
});
