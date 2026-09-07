import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb, type MockDbMocks } from './mocks';
import {
    createFileFixture,
    createNewFileFixture,
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_USER_ID,
    TEST_FILE_ID,
} from './fixtures';
import { createFileRepo, originalKey, type File, type FileRepo } from './files';

describe('files repository', () => {
    let mocks: MockDbMocks;
    let repo: FileRepo;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createFileRepo(mockDb.db);
    });

    describe('findById', () => {
        it('returns file when found', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);

            const result = await repo.findById(TEST_FILE_ID);

            expect(result).toEqual(file);
            expect(mocks.files.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when not found', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            const result = await repo.findById('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('findByUserAndId', () => {
        it('returns file when user owns it', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);

            const result = await repo.findByUserAndId(
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(file);
            expect(mocks.files.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when user does not own file', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            const result = await repo.findByUserAndId(
                'other_user',
                TEST_FILE_ID
            );

            expect(result).toBeUndefined();
        });
    });

    describe('findManyByUserAndIds', () => {
        it('returns files matching ids owned by user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(files);
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await repo.findManyByUserAndIds(TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.files.findMany).not.toHaveBeenCalled();
        });

        it('returns only files that exist and are owned by user', async () => {
            const files = [createFileFixture({ id: 'file1' })];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toHaveLength(1);
        });
    });

    describe('findExistingByNameAndSize', () => {
        it('matches on name and size together', async () => {
            mocks.files.findMany.mockResolvedValue([
                createFileFixture({ name: 'IMG_0001.CR2', size: 100 }),
                // Same name, different size: a re-export, not a duplicate.
                createFileFixture({ name: 'IMG_0001.CR2', size: 200 }),
            ]);

            const result = await repo.findExistingByNameAndSize(TEST_USER_ID, [
                { name: 'IMG_0001.CR2', size: 100 },
                { name: 'IMG_0002.CR2', size: 100 },
            ]);

            expect(result).toEqual([{ name: 'IMG_0001.CR2', size: 100 }]);
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });

        it('answers once per identity when the vault already holds copies', async () => {
            mocks.files.findMany.mockResolvedValue([
                createFileFixture({ id: 'copy1', name: 'clip.mp4', size: 5 }),
                createFileFixture({ id: 'copy2', name: 'clip.mp4', size: 5 }),
            ]);

            const result = await repo.findExistingByNameAndSize(TEST_USER_ID, [
                { name: 'clip.mp4', size: 5 },
            ]);

            expect(result).toEqual([{ name: 'clip.mp4', size: 5 }]);
        });

        it('returns empty array without querying when given no candidates', async () => {
            const result = await repo.findExistingByNameAndSize(
                TEST_USER_ID,
                []
            );

            expect(result).toEqual([]);
            expect(mocks.files.findMany).not.toHaveBeenCalled();
        });
    });

    describe('findByUser', () => {
        const DEFAULT_OPTS = { limit: 50, offset: 0 } as const;

        it('returns array of files for user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findByUser(TEST_USER_ID, DEFAULT_OPTS);

            expect(result).toEqual(files);
            expect(result).toHaveLength(2);
        });

        it('respects custom pagination options', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, { limit: 10, offset: 20 });

            expect(mocks.files.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                })
            );
        });

        it('returns empty array when user has no files', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            const result = await repo.findByUser(TEST_USER_ID, DEFAULT_OPTS);

            expect(result).toEqual([]);
        });

        it('respects includeHidden option', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, {
                limit: 50,
                offset: 0,
                includeHidden: true,
            });

            // When includeHidden is true, the where clause should only filter by userId
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });
    });

    describe('countThumbnailStatuses', () => {
        it('fills in zero for statuses no row has', async () => {
            mocks.groupByRows.mockResolvedValue([
                { status: 'ready', count: 7 },
                { status: 'failed_cold', count: 2 },
            ]);

            const result = await repo.countThumbnailStatuses();

            expect(result).toEqual({
                pending: 0,
                ready: 7,
                failed: 0,
                failed_cold: 2,
                skipped: 0,
            });
        });
    });

    describe('findLatestReadyThumbnail', () => {
        it('returns the row the query finds', async () => {
            const row = { id: TEST_FILE_ID, userId: TEST_USER_ID };
            mocks.files.findFirst.mockResolvedValue(row);

            const result = await repo.findLatestReadyThumbnail();

            expect(result).toEqual(row);
            expect(mocks.files.findFirst).toHaveBeenCalledOnce();
        });
    });

    describe('countByUser', () => {
        it('returns count of files for user', async () => {
            mocks.where.mockResolvedValue([{ count: 42 }]);

            const result = await repo.countByUser(TEST_USER_ID);

            expect(result).toBe(42);
        });

        it('returns 0 when user has no files', async () => {
            mocks.where.mockResolvedValue([{ count: 0 }]);

            const result = await repo.countByUser(TEST_USER_ID);

            expect(result).toBe(0);
        });

        it('respects includeHidden option', async () => {
            mocks.where.mockResolvedValue([{ count: 10 }]);

            await repo.countByUser(TEST_USER_ID, { includeHidden: true });

            expect(mocks.where).toHaveBeenCalledOnce();
        });
    });

    describe('sumStorageByUser', () => {
        it('returns sum of file sizes', async () => {
            mocks.where.mockResolvedValue([{ total: 5000000 }]);

            const result = await repo.sumStorageByUser(TEST_USER_ID);

            expect(result).toBe(5000000);
        });

        it('returns 0 when user has no files', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);

            const result = await repo.sumStorageByUser(TEST_USER_ID);

            expect(result).toBe(0);
        });
    });

    describe('insert', () => {
        it('returns inserted file', async () => {
            const newFile = createNewFileFixture();
            const insertedFile = createFileFixture();
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await repo.insert(newFile);

            expect(result).toEqual(insertedFile);
            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(newFile);
        });
    });

    describe('update', () => {
        it('returns updated file', async () => {
            const updatedFile = createFileFixture({ name: 'new-name.pdf' });
            mocks.returning.mockResolvedValue([updatedFile]);

            const result = await repo.update(TEST_FILE_ID, {
                name: 'new-name.pdf',
            });

            expect(result).toEqual(updatedFile);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith({ name: 'new-name.pdf' });
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.update('nonexistent', {
                name: 'test.pdf',
            });

            expect(result).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('returns deleted file', async () => {
            const deletedFile = createFileFixture();
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await repo.delete(TEST_FILE_ID);

            expect(result).toEqual(deletedFile);
            expect(mocks.delete).toHaveBeenCalledOnce();
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.delete('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    // The status predicate itself only means anything against a real database
    // — `files.integration.test.ts` races it.
    describe('claimUpload', () => {
        it('confirms to available without stamping deletedAt', async () => {
            const availableFile = createFileFixture({ status: 'available' });
            mocks.returning.mockResolvedValue([availableFile]);

            const result = await repo.claimUpload(
                TEST_USER_ID,
                TEST_FILE_ID,
                'available'
            );

            expect(result).toEqual(availableFile);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'available' });
        });

        it('releases to deleted with deletedAt', async () => {
            const deletedFile = createFileFixture({
                status: 'deleted',
                deletedAt: new Date(),
            });
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await repo.claimUpload(
                TEST_USER_ID,
                TEST_FILE_ID,
                'deleted'
            );

            expect(result).toEqual(deletedFile);
            expect(mocks.set).toHaveBeenCalledWith({
                status: 'deleted',
                deletedAt: expect.any(Date),
            });
        });

        it('returns undefined when no uploading row matches', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.claimUpload(
                TEST_USER_ID,
                TEST_FILE_ID,
                'deleted'
            );

            expect(result).toBeUndefined();
        });
    });

    describe('softDeleteMany', () => {
        it('returns soft-deleted files', async () => {
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            const result = await repo.softDeleteMany(['file1', 'file2']);

            expect(result).toEqual(deletedFiles);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns empty array when given empty array', async () => {
            const result = await repo.softDeleteMany([]);

            expect(result).toEqual([]);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('returns empty array when no files match', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.softDeleteMany(['nonexistent']);

            expect(result).toEqual([]);
        });
    });

    describe('softDeleteForUser', () => {
        it('returns soft-deleted files for user', async () => {
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            const result = await repo.softDeleteForUser(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(deletedFiles);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns empty array when given empty array', async () => {
            const result = await repo.softDeleteForUser(TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('returns empty array when no files match user', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.softDeleteForUser(TEST_USER_ID, [
                'nonexistent',
            ]);

            expect(result).toEqual([]);
        });
    });

    describe('findByUserAndBatch', () => {
        it('returns files in the batch owned by user', async () => {
            const files = [
                createFileFixture({ id: 'f1', batchId: TEST_BATCH_ID }),
                createFileFixture({ id: 'f2', batchId: TEST_BATCH_ID }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findByUserAndBatch(
                TEST_USER_ID,
                TEST_BATCH_ID
            );

            expect(result).toEqual(files);
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when batch has no files for user', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            const result = await repo.findByUserAndBatch(
                TEST_USER_ID,
                TEST_BATCH_ID
            );

            expect(result).toEqual([]);
        });
    });

    describe('findByUserGroupedByBatch', () => {
        // Shape of one joined row as the query returns it (no retrieval)
        function buildGroupedRow(
            file: File,
            batch: ReturnType<typeof createUploadBatchFixture> | null = null
        ) {
            return {
                file,
                batchName: batch?.name ?? null,
                batchCreatedAt: batch?.createdAt ?? null,
                retrievalStatus: null,
                retrievalExpiresAt: null,
            };
        }

        it('groups files by batch and emits a null-batchId group for legacy files', async () => {
            const batch = createUploadBatchFixture({
                id: 'batch-1',
                name: 'Silva Wedding',
            });
            const fileInBatch = createFileFixture({
                id: 'f-batched',
                batchId: 'batch-1',
            });
            const orphanFile = createFileFixture({
                id: 'f-legacy',
                batchId: null,
            });
            mocks.orderBy.mockResolvedValue([
                {
                    file: fileInBatch,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                    retrievalStatus: null,
                    retrievalExpiresAt: null,
                },
                {
                    file: orphanFile,
                    batchName: null,
                    batchCreatedAt: null,
                    retrievalStatus: null,
                    retrievalExpiresAt: null,
                },
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toHaveLength(2);
            const named = result.find((g) => g.batchId === 'batch-1');
            expect(named).toBeDefined();
            expect(named!.batchName).toBe('Silva Wedding');
            expect(named!.files).toEqual([
                { ...fileInBatch, activeRetrieval: null },
            ]);

            const orphan = result.find((g) => g.batchId === null);
            expect(orphan).toBeDefined();
            expect(orphan!.batchName).toBeNull();
            expect(orphan!.batchCreatedAt).toBeNull();
            expect(orphan!.files).toEqual([
                { ...orphanFile, activeRetrieval: null },
            ]);
        });

        it('attaches the joined active retrieval to its file', async () => {
            const file = createFileFixture({ id: 'f-ready', batchId: null });
            const expiresAt = new Date('2026-07-10T00:00:00Z');
            mocks.orderBy.mockResolvedValue([
                {
                    file,
                    batchName: null,
                    batchCreatedAt: null,
                    retrievalStatus: 'ready',
                    retrievalExpiresAt: expiresAt,
                },
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result[0].files).toEqual([
                {
                    ...file,
                    activeRetrieval: { status: 'ready', expiresAt },
                },
            ]);
        });

        it('returns empty array when user has no files', async () => {
            mocks.orderBy.mockResolvedValue([]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toEqual([]);
        });

        it('keeps multiple files in a single batch under one group', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            const f1 = createFileFixture({ id: 'f1', batchId: 'b' });
            const f2 = createFileFixture({ id: 'f2', batchId: 'b' });
            mocks.orderBy.mockResolvedValue([
                {
                    file: f1,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                    retrievalStatus: null,
                    retrievalExpiresAt: null,
                },
                {
                    file: f2,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                    retrievalStatus: null,
                    retrievalExpiresAt: null,
                },
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toHaveLength(1);
            expect(result[0].files).toEqual([
                { ...f1, activeRetrieval: null },
                { ...f2, activeRetrieval: null },
            ]);
        });

        it('orders files within a batch by natural filename, not upload order (#404)', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            // Query order (newest upload first), deliberately unlike name order
            const uploadOrder = [
                'IMG_2.JPG',
                'IMG_10.JPG',
                'IMG_1.JPG',
                'IMG_9.JPG',
            ].map((name, i) =>
                createFileFixture({ id: `f${i}`, batchId: 'b', name })
            );
            mocks.orderBy.mockResolvedValue(
                uploadOrder.map((file) => buildGroupedRow(file, batch))
            );

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result[0].files.map((f) => f.name)).toEqual([
                'IMG_1.JPG',
                'IMG_2.JPG',
                'IMG_9.JPG',
                'IMG_10.JPG',
            ]);
        });

        it('breaks filename ties by upload time, then id, regardless of query order', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            const older = new Date('2026-08-01T10:00:00Z');
            const newer = new Date('2026-08-01T10:05:00Z');
            const rows = [
                { id: 'f-c', createdAt: newer },
                { id: 'f-b', createdAt: older },
                { id: 'f-a', createdAt: older },
            ].map(({ id, createdAt }) =>
                buildGroupedRow(
                    createFileFixture({
                        id,
                        batchId: 'b',
                        name: 'IMG_0001.JPG',
                        createdAt,
                    }),
                    batch
                )
            );
            mocks.orderBy.mockResolvedValue(rows);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result[0].files.map((f) => f.id)).toEqual([
                'f-a',
                'f-b',
                'f-c',
            ]);
        });

        it('treats leading zeros as numerically equal and breaks the tie by upload time', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            const older = new Date('2026-08-01T10:00:00Z');
            const newer = new Date('2026-08-01T10:05:00Z');
            // The numeric collator compares IMG_0001 and IMG_1 as equal, so
            // their relative order comes from the tie-break, not the zeros.
            const rows = [
                { name: 'IMG_10.JPG', createdAt: older },
                { name: 'IMG_0001.JPG', createdAt: newer },
                { name: 'IMG_0002.JPG', createdAt: older },
                { name: 'IMG_1.JPG', createdAt: older },
            ].map(({ name, createdAt }) =>
                buildGroupedRow(
                    createFileFixture({
                        id: name,
                        batchId: 'b',
                        name,
                        createdAt,
                    }),
                    batch
                )
            );
            mocks.orderBy.mockResolvedValue(rows);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result[0].files.map((f) => f.name)).toEqual([
                'IMG_1.JPG',
                'IMG_0001.JPG',
                'IMG_0002.JPG',
                'IMG_10.JPG',
            ]);
        });

        it('orders mixed-case names numerically, lowercase first when only case differs', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            const rows = [
                'IMG_10.JPG',
                'IMG_2.JPG',
                'img_9.jpg',
                'img_2.jpg',
                'Img_1.jpg',
            ].map((name) =>
                buildGroupedRow(
                    createFileFixture({ id: name, batchId: 'b', name }),
                    batch
                )
            );
            mocks.orderBy.mockResolvedValue(rows);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            // Case never outranks the number, so camera-name casing
            // differences don't split a sequence apart.
            expect(result[0].files.map((f) => f.name)).toEqual([
                'Img_1.jpg',
                'img_2.jpg',
                'IMG_2.JPG',
                'img_9.jpg',
                'IMG_10.JPG',
            ]);
        });

        it('keeps batch order while sorting each batch independently', async () => {
            const newerBatch = createUploadBatchFixture({ id: 'b-new' });
            const olderBatch = createUploadBatchFixture({ id: 'b-old' });
            const buildRow = (
                id: string,
                batch: typeof newerBatch | null,
                name: string
            ) =>
                buildGroupedRow(
                    createFileFixture({ id, batchId: batch?.id ?? null, name }),
                    batch
                );
            mocks.orderBy.mockResolvedValue([
                buildRow('n2', newerBatch, 'b.jpg'),
                buildRow('n1', newerBatch, 'a.jpg'),
                buildRow('o2', olderBatch, 'd.jpg'),
                buildRow('o1', olderBatch, 'c.jpg'),
                buildRow('u2', null, 'f.jpg'),
                buildRow('u1', null, 'e.jpg'),
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(
                result.map((g) => [g.batchId, g.files.map((f) => f.id)])
            ).toEqual([
                ['b-new', ['n1', 'n2']],
                ['b-old', ['o1', 'o2']],
                [null, ['u1', 'u2']],
            ]);
        });
    });
});

describe('originalKey', () => {
    it('builds the four-segment upload key', () => {
        expect(
            originalKey({
                userId: 'usr_1',
                batchId: 'batch_1',
                id: 'file_1',
                name: '_MG_4501.CR2',
            })
        ).toBe('usr_1/batch_1/file_1/_MG_4501.CR2');
    });
});
