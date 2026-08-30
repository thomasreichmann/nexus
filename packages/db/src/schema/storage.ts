import { sql } from 'drizzle-orm';
import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    integer,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { DEFAULT_RESTORE_TIER, RESTORE_TIERS } from '../objectState';
import { user } from './auth';
import { timestamps } from './helpers';

// The retrieval-policy constants are defined in `../objectState`, not here:
// client components import them, and reaching them through this file would
// ship drizzle and every table below to the browser. Re-exported so
// `@nexus/db/schema` consumers still find them where they always were.
export {
    RESTORE_TIERS,
    DEFAULT_RESTORE_TIER,
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    ZIP_BUILD_RESTORE_DAYS,
    type RestoreTier,
} from '../objectState';

// Nexus domain tables

export const fileStatusEnum = pgEnum('file_status', [
    'uploading',
    'available',
    'restoring',
    'deleted',
]);

export const retrievalStatusEnum = pgEnum('retrieval_status', [
    'pending', // Request created, not yet sent to AWS
    'in_progress', // AWS restore initiated, waiting for completion
    'ready', // File restored and available for download
    'expired', // Temporary restore window has passed
    'failed', // Restore failed (e.g., file deleted, AWS error)
    'cancelled', // User cancelled before completion
]);

export const retrievalTierEnum = pgEnum('retrieval_tier', RESTORE_TIERS);

export const retrievalArtifactStatusEnum = pgEnum('retrieval_artifact_status', [
    'pending', // Chunk assigned, no build job has claimed it yet
    'building', // A zip job holds it; `startedAt` says since when
    'ready', // Zip exists at `s3Key` and can be handed to the user
    'failed', // Build failed; `attempts`/`error` carry the retry history
]);

export const thumbnailStatusEnum = pgEnum('thumbnail_status', [
    'pending', // Set at insert; generate-thumbnail job not yet completed
    'ready', // WebP exists in the derived bucket (worker writes S3 first)
    'failed', // Bad/unreadable file — icon fallback forever
    'failed_cold', // Original hit Deep Archive before generation; self-heals on restore
    'skipped', // No thumbnail applicable: deleted before the job ran, or non-media type
]);

// Groups files uploaded together in a single session. The natural unit of
// work for photographers is "a shoot" — one wedding/event = one batch. Batch
// FK is nullable on files/retrievals so legacy rows (pre-batch) keep working.
export const uploadBatches = pgTable(
    'upload_batches',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        ...timestamps(),
    },
    (table) => [index('upload_batches_user_id_idx').on(table.userId)]
);

export const files = pgTable(
    'files',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // Nullable: legacy files predate batches; `set null` preserves the
        // file row when a batch is removed (rare; prevents data loss).
        batchId: text('batch_id').references(() => uploadBatches.id, {
            onDelete: 'set null',
        }),
        name: text('name').notNull(),
        size: bigint('size', { mode: 'number' }).notNull(),
        mimeType: text('mime_type'),
        s3Key: text('s3_key').notNull().unique(),
        status: fileStatusEnum('status').notNull().default('uploading'),
        // Thumbnail lifecycle for the derived-bucket WebP. No key column:
        // the derived key is a pure function of immutable row fields
        // (`${userId}/${fileId}/thumb.webp`), so the DB stays source of truth.
        thumbnailStatus: thumbnailStatusEnum('thumbnail_status')
            .notNull()
            .default('pending'),
        // Worker-populated once the thumbnail is ready. Not consumed by the
        // grid yet (its media boxes are a fixed ratio by design); kept for
        // exact-aspect sizing in a future lightbox/preview surface.
        thumbnailWidth: integer('thumbnail_width'),
        thumbnailHeight: integer('thumbnail_height'),
        // Video-only, from ffprobe; drives the duration badge.
        durationSeconds: integer('duration_seconds'),
        ...timestamps(),
        lastAccessedAt: timestamp('last_accessed_at'),
        deletedAt: timestamp('deleted_at'),
    },
    (table) => [
        index('files_user_id_idx').on(table.userId),
        index('files_status_idx').on(table.status),
        index('files_batch_id_idx').on(table.batchId),
        index('files_user_id_created_at_idx').on(
            table.userId,
            table.createdAt.desc()
        ),
    ]
);

export const storageUsage = pgTable(
    'storage_usage',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .unique()
            .references(() => user.id, { onDelete: 'cascade' }),
        usedBytes: bigint('used_bytes', { mode: 'number' })
            .notNull()
            .default(0),
        fileCount: integer('file_count').notNull().default(0),
        ...timestamps(),
    },
    (table) => [index('storage_usage_user_id_idx').on(table.userId)]
);

export const retrievals = pgTable(
    'retrievals',
    {
        id: text('id').primaryKey(),
        fileId: text('file_id')
            .notNull()
            .references(() => files.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // DEPRECATED (#422): the grouping key for a restore is now
        // `retrieval_requests`, and an upload batch is recorded there as the
        // selection mechanism it always was. Nothing reads or writes this
        // column any more; it survives only because dropping it is destructive
        // DDL, which ships alone once every plane is deployed without it.
        batchId: text('batch_id').references(() => uploadBatches.id, {
            onDelete: 'set null',
        }),
        status: retrievalStatusEnum('status').notNull().default('pending'),
        tier: retrievalTierEnum('tier').notNull().default(DEFAULT_RESTORE_TIER),
        initiatedAt: timestamp('initiated_at'), // When AWS restore was started
        readyAt: timestamp('ready_at'), // When file became available
        expiresAt: timestamp('expires_at'), // When temporary restore expires
        // The `Days` we asked S3 for (#424). A fact from request time, not a
        // prediction: S3's own clock starts when the restore *completes*, which
        // is why `expiresAt` is still read from the restore header rather than
        // computed from this. It exists because the two windows now differ —
        // a zip-delivered restore buys ZIP_BUILD_RESTORE_DAYS, a direct one
        // DEFAULT_RESTORE_DAYS_TO_KEEP — and the poll's fallback for a header
        // with no `expiry-date` would otherwise always quote the longer.
        // Null on rows predating the split; they were all created at the
        // default.
        restoreDaysToKeep: integer('restore_days_to_keep'),
        failedAt: timestamp('failed_at'), // When failure occurred
        errorMessage: text('error_message'), // AWS error details if failed
        ...timestamps(),
    },
    (table) => [
        index('retrievals_file_id_idx').on(table.fileId),
        index('retrievals_user_id_idx').on(table.userId),
        index('retrievals_status_idx').on(table.status),
        index('retrievals_batch_id_idx').on(table.batchId),
        index('retrievals_expires_at_idx').on(table.expiresAt),
        // At most one active retrieval per file. `expires_at > now()` isn't
        // indexable (now() is not IMMUTABLE), so a lapsed `ready` row still
        // occupies the index slot until the insert path flips it to
        // `expired` — see expireLapsedByFileIds in repositories/retrievals.
        uniqueIndex('retrievals_active_file_id_idx')
            .on(table.fileId)
            .where(sql`status IN ('pending', 'in_progress', 'ready')`),
    ]
);

// The identity of one restore (#422). Every restore creates one, whatever
// selected its files — a multi-select in the browser, a whole upload batch, or
// a single file. It is what the zip artifacts hang off and what "is my restore
// ready?" is asked about; readiness itself is not stored here but computed
// from the request's items, so a stored answer can never drift from the
// retrieval rows that produce it.
export const retrievalRequests = pgTable(
    'retrieval_requests',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // How the file set was chosen, when that was an upload batch. Null for
        // an ad-hoc selection or a single file — a batch is one selection
        // mechanism among several, not the request's identity. `set null` so
        // deleting the batch doesn't wipe the restore's provenance.
        uploadBatchId: text('upload_batch_id').references(
            () => uploadBatches.id,
            { onDelete: 'set null' }
        ),
        // The tier every retrieval in the request was initiated at. Stored on
        // the request because it is a property of what the user asked for, not
        // of an individual file.
        //
        // Bulk by default (#423): the pricing model always assumed Bulk
        // ($0.0025/GB vs Standard's $0.02/GB) and the all-Standard behavior it
        // replaced was an unrevisited zod default, not a decision. Standard is
        // the upsell candidate, not the floor.
        tier: retrievalTierEnum('tier').notNull().default(DEFAULT_RESTORE_TIER),
        // When the last artifact finished building (#424) — the moment the
        // request became downloadable as a whole.
        //
        // Stored, unlike readiness above, because this is a transition rather
        // than an answer: it is what elects a single winner among the zip jobs
        // racing to finish last, and therefore what #426 hangs its one email
        // off. It cannot drift from the artifacts either, because the only
        // statement that sets it also asserts every artifact is `ready` (see
        // completeIfArtifactsReady in repositories/retrievalRequests).
        completedAt: timestamp('completed_at'),
        ...timestamps(),
    },
    (table) => [
        index('retrieval_requests_user_id_created_at_idx').on(
            table.userId,
            table.createdAt.desc()
        ),
        index('retrieval_requests_upload_batch_id_idx').on(table.uploadBatchId),
    ]
);

// One zip of a request. A request has 1..N: the ready file set is partitioned
// into chunks so no single archive gets too large to download or open (#424
// builds them; this table is what it builds into). Each row carries its own
// build lifecycle so one chunk can be retried or rebuilt without touching its
// siblings.
export const retrievalArtifacts = pgTable(
    'retrieval_artifacts',
    {
        id: text('id').primaryKey(),
        requestId: text('request_id')
            .notNull()
            .references(() => retrievalRequests.id, { onDelete: 'cascade' }),
        // Ordinal within the request — the "part 2 of 5" the user sees. Stable
        // across a rebuild, which is why it is stored rather than derived from
        // row order.
        position: integer('position').notNull(),
        status: retrievalArtifactStatusEnum('status')
            .notNull()
            .default('pending'),
        // Stored, not derived from the row's ids: a rebuild writes a new object
        // so an in-flight download can't resolve to a half-written zip. A
        // computed key has no way to express that (cf. `thumbnailKey`).
        s3Key: text('s3_key'),
        sizeBytes: bigint('size_bytes', { mode: 'number' }),
        // Retry bookkeeping, mirroring background_jobs: the count is what a
        // rebuild decides against, the message is what an operator reads.
        attempts: integer('attempts').notNull().default(0),
        error: text('error'),
        startedAt: timestamp('started_at'),
        completedAt: timestamp('completed_at'),
        ...timestamps(),
    },
    (table) => [
        // One chunk per position per request — the guard that makes an
        // idempotent partition safe to re-run after a crash mid-enqueue.
        uniqueIndex('retrieval_artifacts_request_id_position_idx').on(
            table.requestId,
            table.position
        ),
        index('retrieval_artifacts_status_created_at_idx').on(
            table.status,
            table.createdAt
        ),
    ]
);

// What a request asked for, one row per file. A join table rather than a
// `request_id` column on `retrievals`, because `retrievals_active_file_id_idx`
// allows only one active retrieval per file: two overlapping requests adopt
// the same retrieval row, and a single FK could only ever name one of them.
export const retrievalRequestItems = pgTable(
    'retrieval_request_items',
    {
        id: text('id').primaryKey(),
        requestId: text('request_id')
            .notNull()
            .references(() => retrievalRequests.id, { onDelete: 'cascade' }),
        fileId: text('file_id')
            .notNull()
            .references(() => files.id, { onDelete: 'cascade' }),
        // The retrieval covering this file, whether this request started it or
        // adopted one already in flight. Nullable because a restore can fail
        // before any row exists — the item still records what was asked for.
        // `set null` for the same reason: losing the retrieval must not lose
        // the request's membership.
        retrievalId: text('retrieval_id').references(() => retrievals.id, {
            onDelete: 'set null',
        }),
        // The zip this file lands in, assigned when the ready set is
        // partitioned (#424). Null until then, and null again after the
        // artifact is dropped for a rebuild — which is what makes a rebuild
        // able to find its own file set.
        artifactId: text('artifact_id').references(
            () => retrievalArtifacts.id,
            { onDelete: 'set null' }
        ),
        ...timestamps(),
    },
    (table) => [
        uniqueIndex('retrieval_request_items_request_id_file_id_idx').on(
            table.requestId,
            table.fileId
        ),
        index('retrieval_request_items_retrieval_id_idx').on(table.retrievalId),
        index('retrieval_request_items_artifact_id_idx').on(table.artifactId),
    ]
);
