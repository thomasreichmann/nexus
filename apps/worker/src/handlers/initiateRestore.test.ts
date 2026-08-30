import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';

const hoisted = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
    const { s3ClientMock } = await import('../testing');
    return { ...actual, S3Client: s3ClientMock(hoisted.send) };
});

import { RestoreObjectCommand } from '@aws-sdk/client-s3';
import { initiateRestore } from './initiateRestore';
import {
    ALREADY_RESTORING,
    notFound,
    restoreInProgress,
    STILL_ARCHIVED,
    WARM,
} from '../testing';
import type { RetrievalRequest } from '@nexus/db/repo/retrievalRequests';

const REQUEST_ID = 'req-1';

function request(
    overrides: Partial<RetrievalRequest> = {}
): Partial<RetrievalRequest> {
    return {
        id: REQUEST_ID,
        userId: 'user-1',
        uploadBatchId: null,
        tier: 'bulk',
        ...overrides,
    };
}

interface PendingRow {
    retrievalId: string;
    fileId: string;
    s3Key: string;
    restoreDaysToKeep: number | null;
}

function pendingRow(overrides: Partial<PendingRow> = {}): PendingRow {
    return {
        retrievalId: 'ret-1',
        fileId: 'file-1',
        s3Key: 'user-1/file-1',
        restoreDaysToKeep: null,
        ...overrides,
    };
}

describe('initiateRestore', () => {
    let db: MockDb;
    let mocks: MockDbMocks;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.S3_BUCKET = 'test-bucket';
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        mocks.retrievalRequests.findFirst.mockResolvedValue(request());
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    /**
     * The handler's work list comes from a select().innerJoin().innerJoin()
     * chain that ends at `.orderBy()`.
     */
    function givenPending(rows: PendingRow[]) {
        mocks.innerJoinOrderBy.mockResolvedValue(rows);
    }

    function run() {
        return initiateRestore({
            jobId: 'job-1',
            payload: { requestId: REQUEST_ID },
            db,
        });
    }

    /** Every RestoreObject the handler issued, in call order. */
    function restoreCalls() {
        return hoisted.send.mock.calls
            .map(([command]) => command)
            .filter((command) => command instanceof RestoreObjectCommand);
    }

    it('restores an archived object at the request’s tier', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        await run();

        expect(restoreCalls()).toHaveLength(1);
        expect(restoreCalls()[0].input).toMatchObject({
            Bucket: 'test-bucket',
            Key: 'user-1/file-1',
            RestoreRequest: {
                Days: expect.any(Number),
                GlacierJobParameters: { Tier: 'Bulk' },
            },
        });
        // A started restore leaves the row pending — the poll observes the end.
        expect(mocks.set).not.toHaveBeenCalled();
    });

    // The request path buys two days when the thawed copy only feeds a zip
    // build and seven when it is the download itself (#424); the handler must
    // ask S3 for what the row says, not restate the policy.
    it('asks S3 for the Days the request path bought', async () => {
        givenPending([pendingRow({ restoreDaysToKeep: 2 })]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        await run();

        expect(restoreCalls()[0].input.RestoreRequest).toMatchObject({
            Days: 2,
        });
    });

    it('falls back to the default Days on a pre-#424 row', async () => {
        givenPending([pendingRow({ restoreDaysToKeep: null })]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        await run();

        expect(restoreCalls()[0].input.RestoreRequest).toMatchObject({
            Days: 7,
        });
    });

    it('uses the tier stored on the request, not a default', async () => {
        mocks.retrievalRequests.findFirst.mockResolvedValue(
            request({ tier: 'standard' })
        );
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(STILL_ARCHIVED);

        await run();

        expect(restoreCalls()[0].input.RestoreRequest).toMatchObject({
            GlacierJobParameters: { Tier: 'Standard' },
        });
    });

    // S3 owns object state (#416): the HEAD is what decides, not a column.
    it('marks a warm object ready without asking for a restore', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(WARM);

        await run();

        expect(restoreCalls()).toHaveLength(0);
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'ready',
                readyAt: expect.any(Date),
                expiresAt: expect.any(Date),
            })
        );
    });

    it('leaves an already-restoring object alone', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockResolvedValue(ALREADY_RESTORING);

        await run();

        expect(restoreCalls()).toHaveLength(0);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    // At-least-once delivery means the same job can run twice; a duplicate
    // RestoreObject that slips past the HEAD is not a failure.
    it('treats RestoreAlreadyInProgress as started', async () => {
        givenPending([pendingRow()]);
        hoisted.send
            .mockResolvedValueOnce(STILL_ARCHIVED)
            .mockRejectedValueOnce(restoreInProgress());

        await expect(run()).resolves.toBeUndefined();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('fails the row AWS rejected and leaves its siblings alone', async () => {
        givenPending([
            pendingRow({ retrievalId: 'r1', s3Key: 'k1' }),
            pendingRow({ retrievalId: 'r2', s3Key: 'k2' }),
        ]);
        hoisted.send.mockImplementation(async (command: unknown) => {
            if (command instanceof RestoreObjectCommand) {
                if (command.input.Key === 'k2')
                    throw new Error('AWS throttled');
                return {};
            }
            return STILL_ARCHIVED;
        });

        await run();

        // Per-row attribution (#329): one failure must not strand the sibling
        // whose restore really did fire.
        expect(mocks.set).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                status: 'failed',
                failedAt: expect.any(Date),
                errorMessage: 'AWS throttled',
            })
        );
    });

    it('fails a row whose object is gone from the bucket', async () => {
        givenPending([pendingRow()]);
        hoisted.send.mockRejectedValue(notFound());

        await run();

        expect(restoreCalls()).toHaveLength(0);
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Object no longer exists in S3',
            })
        );
    });

    // A HEAD that fails for any other reason falls through as archived rather
    // than inventing a second failure path for the same outage.
    it('still attempts the restore when the HEAD itself fails', async () => {
        givenPending([pendingRow()]);
        hoisted.send
            .mockRejectedValueOnce(new Error('AccessDenied'))
            .mockResolvedValueOnce({});

        await run();

        expect(restoreCalls()).toHaveLength(1);
    });

    // The scheduled/queued worker has no other loudness: `nexus-worker-errors`
    // watches the Lambda Errors metric, which only sees a whole-invocation
    // throw. The handler is idempotent, so the SQS retry costs only HEADs.
    it('throws when every file failed, so the Lambda error metric sees it', async () => {
        givenPending([
            pendingRow({ retrievalId: 'r1', s3Key: 'k1' }),
            pendingRow({ retrievalId: 'r2', s3Key: 'k2' }),
        ]);
        hoisted.send.mockImplementation(async (command: unknown) => {
            if (command instanceof RestoreObjectCommand) {
                throw new Error('AccessDenied');
            }
            return STILL_ARCHIVED;
        });

        await expect(run()).rejects.toThrow('failed for all 2 files');
    });

    it('does not throw when at least one file was started', async () => {
        givenPending([
            pendingRow({ retrievalId: 'r1', s3Key: 'k1' }),
            pendingRow({ retrievalId: 'r2', s3Key: 'k2' }),
        ]);
        hoisted.send.mockImplementation(async (command: unknown) => {
            if (command instanceof RestoreObjectCommand) {
                if (command.input.Key === 'k2') throw new Error('AccessDenied');
                return {};
            }
            return STILL_ARCHIVED;
        });

        await expect(run()).resolves.toBeUndefined();
    });

    // The user was deleted between the request and the job; nothing to do is a
    // completed job, not a retry.
    it('completes quietly when the request is gone', async () => {
        mocks.retrievalRequests.findFirst.mockResolvedValue(undefined);

        await expect(run()).resolves.toBeUndefined();

        expect(hoisted.send).not.toHaveBeenCalled();
    });

    // A swallowed write leaves the row `pending`, so counting it as ready would
    // make the run's log claim work that never landed.
    it('does not count a row whose status write failed', async () => {
        givenPending([
            pendingRow({ retrievalId: 'r1', s3Key: 'k1' }),
            pendingRow({ retrievalId: 'r2', s3Key: 'k2' }),
        ]);
        hoisted.send.mockResolvedValue(WARM);
        mocks.returning.mockRejectedValueOnce(new Error('db connection lost'));

        await run();

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('initiate-restore'),
            expect.stringContaining('"ready":1')
        );
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('initiate-restore'),
            expect.stringContaining('"errored":1')
        );
    });

    // A redelivery after a clean run: every row has already been settled, so
    // the work list is empty and S3 is never touched.
    it('does nothing when no row is still pending', async () => {
        givenPending([]);

        await run();

        expect(hoisted.send).not.toHaveBeenCalled();
    });
});
