import { z } from 'zod';
import { DEFAULT_RESTORE_TIER, RESTORE_TIERS } from '@nexus/db/schema';
import { createFileRepo } from '@nexus/db/repo/files';
import { createLibraryRepo } from '@nexus/db/repo/library';
import { fileService } from '@/server/services/files';
import { retrievalService } from '@/server/services/retrieval';
import { BATCH_PAGE_SIZE, FILE_PAGE_SIZE } from '@/lib/library/paging';
import { MAX_FILES_PER_VAULT_LOOKUP } from '@/lib/upload/limits';
import { normalizeSubpath } from '@/lib/upload/rows';
import { protectedProcedure, router } from '../init';

// One rule for both ways a batch gets named: per-file on `upload`, and up front
// on `createBatch`.
const batchNameSchema = z.string().min(1).max(255);
// Stated once: the name limit an upload accepts is the one the vault check
// (`findDuplicates`) matches against.
const fileNameSchema = z.string().min(1).max(255);

// Shoot-to-full-archive scale, not the old 100 (#423, #400). A wedding
// re-delivery is 500-1,500 files and the disaster-recovery case #406 is built
// around is a whole library — the ICP reference is 8,934. The file browser
// now pages (#455) and runs whole-batch actions by batch id, but an API caller
// selecting by id still gets the full backlog. Shared by `deleteMany` and
// `requestBulkRetrieval` so the two can't drift; unrelated to the `10000` in
// `multipart.complete`, which is S3's part-count limit.
const MAX_BULK_FILE_IDS = 10_000;

// The folder a file sat in, relative to its batch (#405).
const subpathSchema = z
    .string()
    .max(1024)
    .optional()
    .transform(normalizeSubpath);

const uploadInputSchema = z.object({
    name: fileNameSchema,
    sizeBytes: z.number().positive(),
    mimeType: z.string().optional(),
    // Join an existing batch by id, or seed a new one with a custom name.
    // Omit both to get an auto-named single-file batch.
    batchId: z.string().uuid().optional(),
    batchName: batchNameSchema.optional(),
    subpath: subpathSchema,
});

// The browser's batch and file ids arrive from its URL (`?batch=`, `?file=`),
// which anyone can edit, so the library's reads take any short string and
// answer a malformed one the way they answer a missing one: with nothing.
// Null is the legacy Ungrouped group.
const libraryIdSchema = z.string().min(1).max(64);
const libraryBatchIdSchema = libraryIdSchema.nullable();
const librarySearchSchema = z.string().trim().max(255).optional();

export const filesRouter = router({
    list: protectedProcedure
        .input(
            z
                .object({
                    limit: z.number().min(1).max(100).default(50),
                    offset: z.number().min(0).default(0),
                    includeHidden: z.boolean().default(false),
                    search: z.string().trim().optional(),
                    sortKey: z
                        .enum(['name', 'size', 'uploadedAt'])
                        .default('uploadedAt'),
                    sortOrder: z.enum(['asc', 'desc']).default('desc'),
                })
                .prefault({})
        )
        .query(async ({ ctx, input }) => {
            const fileRepo = createFileRepo(ctx.db);
            const { limit, offset, includeHidden, search, sortKey, sortOrder } =
                input;
            const userId = ctx.session.user.id;

            const [files, total] = await Promise.all([
                fileRepo.findByUser(userId, {
                    limit,
                    offset,
                    includeHidden,
                    search,
                    sortKey,
                    sortOrder,
                }),
                fileRepo.countByUser(userId, { includeHidden, search }),
            ]);

            return {
                files,
                total,
                hasMore: offset + files.length < total,
            };
        }),

    // Library-wide status bucket counts. Split from `list` so paging/search/
    // sort don't trigger this scan, and so the dashboard preview (which only
    // wants the file list) doesn't pay for it on every load.
    statusCounts: protectedProcedure.query(({ ctx }) => {
        const fileRepo = createFileRepo(ctx.db);
        return fileRepo.countStatusesByUser(ctx.session.user.id);
    }),

    // The file browser's library (#455): batch summaries a page at a time,
    // newest first, from one aggregate query. `cursor` is the last batch id
    // of the previous page (tRPC's infinite-query param); the first page also
    // carries how many batches the library (or the search) holds.
    listBatches: protectedProcedure
        .input(
            z
                .object({
                    search: librarySearchSchema,
                    cursor: libraryIdSchema.nullish(),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(50)
                        .default(BATCH_PAGE_SIZE),
                })
                .prefault({})
        )
        .query(async ({ ctx, input }) => {
            const libraryRepo = createLibraryRepo(ctx.db);
            const userId = ctx.session.user.id;
            const [page, total] = await Promise.all([
                libraryRepo.listBatchSummaries(userId, input),
                input.cursor
                    ? null
                    : libraryRepo.countBatches(userId, {
                          search: input.search,
                      }),
            ]);
            return { ...page, total };
        }),

    // One batch, opened: its summary and its folders. Null for a batch that
    // isn't the user's, or has nothing left in it.
    getBatch: protectedProcedure
        .input(
            z.object({
                batchId: libraryBatchIdSchema,
                search: librarySearchSchema,
            })
        )
        .query(async ({ ctx, input }) => {
            const batch = await createLibraryRepo(ctx.db).findBatch(
                ctx.session.user.id,
                input.batchId,
                { search: input.search }
            );
            return batch ?? null;
        }),

    // A page of an open batch's files (or one folder's), in natural filename
    // order, paged both ways from a cursor file: `direction` is tRPC's own
    // infinite-query param. A deep link opens forward from `locate`'s
    // `pageStartId`.
    listBatchFiles: protectedProcedure
        .input(
            z.object({
                batchId: libraryBatchIdSchema,
                folder: z.string().max(1024).nullable().optional(),
                search: librarySearchSchema,
                cursor: libraryIdSchema.nullish(),
                direction: z.enum(['forward', 'backward']).default('forward'),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(FILE_PAGE_SIZE)
                    .default(FILE_PAGE_SIZE),
            })
        )
        .query(({ ctx, input }) =>
            createLibraryRepo(ctx.db).listBatchFiles(ctx.session.user.id, input)
        ),

    // Where a deep-linked file sits (`?file=`, the retrieval-ready email): its
    // batch, its folder and the first file of its page, or null when it isn't
    // the user's or is gone.
    locate: protectedProcedure
        .input(z.object({ fileId: libraryIdSchema }))
        .query(async ({ ctx, input }) => {
            const located = await createLibraryRepo(ctx.db).locateFile(
                ctx.session.user.id,
                input.fileId,
                { pageSize: FILE_PAGE_SIZE }
            );
            return located ?? null;
        }),

    get: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(({ ctx, input }) => {
            const fileRepo = createFileRepo(ctx.db);
            return fileRepo.findByUserAndId(ctx.session.user.id, input.id);
        }),

    // Pre-create a session batch so a multi-file upload can pass one batchId to
    // every per-file initiate call. The browser names it after the dropped
    // folder, or else after the click in its own time zone (#408); without a
    // name the batch gets the server's UTC timestamp fallback.
    createBatch: protectedProcedure
        .input(z.object({ name: batchNameSchema.optional() }).prefault({}))
        .mutation(({ ctx, input }) =>
            fileService.createBatch(ctx.db, ctx.session.user.id, input.name)
        ),

    upload: protectedProcedure
        .input(uploadInputSchema)
        .mutation(async ({ ctx, input }) => {
            return fileService.initiateUpload(
                ctx.db,
                ctx.session.user.id,
                input,
                await ctx.getSubscription()
            );
        }),

    confirmUpload: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.confirmUpload(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),

    // Top-level, not under `multipart`: it serves both engines.
    abandonUpload: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.abandonUpload(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),

    delete: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.deleteUserFile(
                ctx.db,
                ctx.session.user.id,
                input.id
            );
        }),

    // The cap raise is cheap here (#400): the delete is one transaction of
    // three statements with no S3 fan-out, so a bigger selection widens the
    // `IN (...)` lists rather than adding round-trips.
    deleteMany: protectedProcedure
        .input(
            z.object({
                ids: z.array(z.string().uuid()).max(MAX_BULK_FILE_IDS),
            })
        )
        .mutation(({ ctx, input }) => {
            return fileService.deleteUserFile(
                ctx.db,
                ctx.session.user.id,
                input.ids
            );
        }),

    // A whole batch by id (#455), however much of it the browser has loaded.
    // Null deletes the legacy Ungrouped files.
    deleteBatch: protectedProcedure
        .input(z.object({ batchId: z.string().uuid().nullable() }))
        .mutation(({ ctx, input }) =>
            fileService.deleteBatch(ctx.db, ctx.session.user.id, input.batchId)
        ),

    // Not null: the legacy Ungrouped files have no batch row to name.
    renameBatch: protectedProcedure
        .input(
            z.object({
                batchId: z.string().uuid(),
                name: z.string().trim().min(1).max(255),
            })
        )
        .mutation(({ ctx, input }) =>
            fileService.renameBatch(
                ctx.db,
                ctx.session.user.id,
                input.batchId,
                input.name
            )
        ),

    requestRetrieval: protectedProcedure
        .input(
            z.object({
                fileId: z.string().uuid(),
                tier: z.enum(RESTORE_TIERS).default(DEFAULT_RESTORE_TIER),
            })
        )
        .mutation(({ ctx, input }) => {
            return retrievalService.requestRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.fileId,
                input.tier
            );
        }),

    // This one survives the cap because the request path is now a fixed handful
    // of statements and the S3 fan-out happens in a worker job (#423), so the
    // cost of a big request is the job's, not the HTTP handler's.
    requestBulkRetrieval: protectedProcedure
        .input(
            z.object({
                fileIds: z
                    .array(z.string().uuid())
                    .min(1)
                    .max(MAX_BULK_FILE_IDS),
                tier: z.enum(RESTORE_TIERS).default(DEFAULT_RESTORE_TIER),
            })
        )
        .mutation(({ ctx, input }) => {
            return retrievalService.requestBulkRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.fileIds,
                input.tier
            );
        }),

    // Null restores the legacy Ungrouped files, which have no batch id.
    requestBatchRetrieval: protectedProcedure
        .input(
            z.object({
                batchId: z.string().uuid().nullable(),
                tier: z.enum(RESTORE_TIERS).default(DEFAULT_RESTORE_TIER),
            })
        )
        .mutation(({ ctx, input }) => {
            return retrievalService.requestBatchRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.batchId,
                input.tier
            );
        }),

    getDownloadUrl: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .query(({ ctx, input }) => {
            return retrievalService.getDownloadUrl(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),

    getThumbnailUrls: protectedProcedure
        .input(
            z.object({ fileIds: z.array(z.string().uuid()).min(1).max(100) })
        )
        .query(({ ctx, input }) => {
            return fileService.getThumbnailUrls(
                ctx.db,
                ctx.session.user.id,
                input.fileIds
            );
        }),

    // The upload queue's vault check (#401): which of a gesture's files are
    // already committed, by name + size. A read, but a mutation on the wire —
    // the input is the whole gesture, which wouldn't fit a GET URL, and a
    // re-drop right after an upload must never be answered from the query
    // cache. Capped by its own wire-sized constant, not the drop cap: the
    // queue chunks its lookups by the same one, so the two can't drift.
    findDuplicates: protectedProcedure
        .input(
            z.object({
                files: z
                    .array(
                        z.object({
                            name: fileNameSchema,
                            size: z.number().int().nonnegative(),
                        })
                    )
                    .min(1)
                    .max(MAX_FILES_PER_VAULT_LOOKUP),
            })
        )
        .mutation(({ ctx, input }) => {
            return createFileRepo(ctx.db).findExistingByNameAndSize(
                ctx.session.user.id,
                input.files
            );
        }),

    multipart: router({
        init: protectedProcedure
            .input(uploadInputSchema)
            .mutation(async ({ ctx, input }) => {
                return fileService.initiateMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input,
                    await ctx.getSubscription()
                );
            }),

        complete: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                    parts: z
                        .array(
                            z.object({
                                partNumber: z.number().int().positive(),
                                etag: z.string().min(1),
                            })
                        )
                        .min(1)
                        .max(10000),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.completeMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input
                );
            }),

        // Reconcile a resumed upload against S3: returns the parts S3 already
        // holds so the client skips them even when its local state is stale.
        // A mutation (not a query) so resume always reconciles fresh — a cached
        // part list would let the client re-upload or skip the wrong parts.
        listParts: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.listMultipartParts(
                    ctx.db,
                    ctx.session.user.id,
                    input.fileId,
                    input.uploadId
                );
            }),

        // Re-presign a specific set of part numbers without restarting the
        // upload — for the parts left on resume and for URLs that expired
        // mid-upload (part URLs live 1 hour).
        signParts: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                    partNumbers: z
                        .array(z.number().int().min(1).max(10000))
                        .min(1)
                        .max(10000),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.signMultipartParts(
                    ctx.db,
                    ctx.session.user.id,
                    {
                        fileId: input.fileId,
                        uploadId: input.uploadId,
                        partNumbers: input.partNumbers,
                    }
                );
            }),

        abort: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.abortMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input.fileId,
                    input.uploadId
                );
            }),
    }),
});
