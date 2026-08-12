import type { DB } from '@nexus/db';
import { createFileRepo, type File } from '@nexus/db/repo/files';
import { createRetrievalRepo, type Retrieval } from '@nexus/db/repo/retrievals';
import { alerts } from '@/lib/alerts';
import { env } from '@/lib/env';
import { emailService } from '@/server/services/email';
import { enqueueThumbnailGeneration } from '@/server/services/thumbnails';
import { logger } from '@/server/lib/logger';
import type { S3EventRecord } from '@/lib/sns/types';
import { PostHogEvent } from '@/lib/posthog/events';
import { captureServerEvent } from '@/lib/posthog/server';
import { resolveStorageTier } from '@/lib/storage/types';

const log = logger.child({ service: 's3-restore' });

type S3RestoreEventHandler = (db: DB, record: S3EventRecord) => Promise<void>;

// Delivered `eventName` values are UNPREFIXED (`ObjectRestore:Completed`),
// unlike the `s3:`-prefixed event types used when configuring bucket
// notifications. Keys here must match the wire format — see the captured
// payloads in webhook_events / docs/guides/webhooks.md.
const handlers: Record<string, S3RestoreEventHandler> = {
    'ObjectRestore:Completed': handleRestoreCompleted,
    'ObjectRestore:Delete': handleRestoreExpired,
    LifecycleTransition: handleLifecycleTransition,
};

// Events we subscribe to but deliberately don't act on. `ObjectRestore:Post`
// fires at restore initiation on every restore — expected, not a coverage gap,
// so routes must not flag it as unhandled.
const expectedUnhandledEvents: ReadonlySet<string> = new Set([
    'ObjectRestore:Post',
]);

// Wire names this service acts on — the single source of truth for consumers
// like scripts/check-s3-event-health.ts.
const handledEventTypes = Object.keys(handlers);

// S3 encodes spaces as `+` in event notification keys
function decodeS3Key(record: S3EventRecord): string {
    return decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
}

async function findFileForRecord(
    db: DB,
    record: S3EventRecord,
    context: string
): Promise<File | null> {
    const s3Key = decodeS3Key(record);
    const file = await createFileRepo(db).findByS3Key(s3Key);
    if (!file) {
        log.warn({ s3Key }, `${context} for unknown file`);
        return null;
    }
    return file;
}

// Unfiltered lookup: the expiry event arrives at/after `expiresAt`, when
// the active-filtered queries no longer see the row.
async function findLatestRetrieval(
    db: DB,
    record: S3EventRecord,
    file: File,
    context: string
): Promise<Retrieval | null> {
    const retrieval = await createRetrievalRepo(db).findLatestByFileId(file.id);
    if (!retrieval) {
        // Rows are written before the restore is requested (#329), so a file
        // with an S3 restore event and no retrieval row at all means a paid
        // restore nothing is tracking — alert, but log too: alerts.send is
        // best-effort (a no-op without a configured transport), and the
        // fileId/s3Key must survive somewhere queryable either way.
        log.error(
            { fileId: file.id, s3Key: file.s3Key, eventType: record.eventName },
            `${context} event with no retrieval row; restore is untracked and the event was dropped`
        );
        await alerts.send({
            severity: 'error',
            title: 'S3 restore event with no retrieval row',
            message: `A ${context} event arrived for a file that has no retrieval record; the restore is untracked and the event was dropped.`,
            context: {
                source: 's3-restore',
                eventType: record.eventName,
                fileId: file.id,
                s3Key: file.s3Key,
            },
        });
        return null;
    }
    return retrieval;
}

// A cold-missed thumbnail (failed_cold) self-heals on ANY completed restore:
// the temporary Standard-class copy is readable, so regeneration succeeds
// without a restore round-trip of its own. Enqueue failures are swallowed
// (in the shared helper) — restore handling must proceed regardless.
async function regenerateColdThumbnail(db: DB, file: File): Promise<void> {
    if (file.thumbnailStatus !== 'failed_cold') return;

    if (await enqueueThumbnailGeneration(db, file.id)) {
        log.info(
            { fileId: file.id },
            'Enqueued thumbnail regeneration after restore'
        );
    }
}

async function handleRestoreCompleted(
    db: DB,
    record: S3EventRecord
): Promise<void> {
    const file = await findFileForRecord(db, record, 'restore completed');
    if (!file) return;

    // Before the retrieval gate: the self-heal applies whenever the object
    // was restored, even outside the app's retrieval flow.
    await regenerateColdThumbnail(db, file);

    const retrieval = await findLatestRetrieval(
        db,
        record,
        file,
        'restore completed'
    );
    if (!retrieval) return;
    const now = new Date();
    const expiresAt = record.glacierEventData?.restoreEventData
        ?.lifecycleRestorationExpiryTime
        ? new Date(
              record.glacierEventData.restoreEventData
                  .lifecycleRestorationExpiryTime
          )
        : undefined;

    await createRetrievalRepo(db).updateStatus(retrieval.id, 'ready', {
        readyAt: now,
        expiresAt,
    });

    log.info(
        { fileId: file.id, retrievalId: retrieval.id, expiresAt },
        'Retrieval marked as ready'
    );

    // No session here — this is an SNS webhook firing hours after the request.
    // file.userId is the only identity available, and it's the same value
    // identify() binds in the browser, so the event lands on the right person.
    captureServerEvent(file.userId, PostHogEvent.RetrievalReady, {
        fileId: file.id,
        retrievalId: retrieval.id,
        storageTier: file.storageTier,
        // How long the tester actually waited on Glacier — the number that
        // decides whether retrieval is a usable feature or a dead end.
        waitMs: retrieval.initiatedAt
            ? now.getTime() - retrieval.initiatedAt.getTime()
            : undefined,
    });

    await sendReadyNotification(db, file, retrieval, expiresAt);
}

// The email links to the app (login → file focused → Download), not a presigned
// S3 URL: presigned URLs expire in an hour while the restore stays downloadable
// until expiresAt, and minting the S3 URL on click keeps it revocable.
async function sendReadyNotification(
    db: DB,
    file: File,
    retrieval: Retrieval,
    expiresAt: Date | undefined
): Promise<void> {
    // Completed events always carry the restore expiry in practice; a missing
    // one means a malformed event, and the template needs a date to render.
    if (!expiresAt) {
        log.warn(
            { fileId: file.id, retrievalId: retrieval.id },
            'Skipping retrieval-ready email: no expiry available'
        );
        return;
    }

    try {
        await emailService.sendRetrievalReadyEmail(db, {
            userId: file.userId,
            fileName: file.name,
            downloadUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/files?file=${file.id}`,
            expiresAt,
        });
    } catch (err) {
        // The restore completed and status is persisted — a notification
        // failure must not mark the webhook event as failed. (The email
        // service swallows send errors itself; this guards its user lookup.)
        log.error(
            { err, fileId: file.id, retrievalId: retrieval.id },
            'Retrieval-ready notification failed after restore completion'
        );
    }
}

async function handleRestoreExpired(
    db: DB,
    record: S3EventRecord
): Promise<void> {
    const file = await findFileForRecord(db, record, 'restore expiry');
    if (!file) return;

    const retrieval = await findLatestRetrieval(
        db,
        record,
        file,
        'restore expiry'
    );
    if (!retrieval) return;

    await createRetrievalRepo(db).updateStatus(retrieval.id, 'expired');

    log.info(
        { fileId: file.id, retrievalId: retrieval.id },
        'Retrieval marked as expired'
    );
}

// Keeps files.storageTier truthful: uploads insert as 'standard' (the class
// every upload lands in) and this flips the row when the bucket lifecycle
// rule actually moves the object. Sub-128KB objects never transition, so
// their rows stay 'standard' permanently — that's correct, not a miss.
async function handleLifecycleTransition(
    db: DB,
    record: S3EventRecord
): Promise<void> {
    const fileRepo = createFileRepo(db);
    const s3Key = decodeS3Key(record);
    const file = await fileRepo.findByS3Key(s3Key);
    if (!file) {
        log.warn({ s3Key }, 'Lifecycle transition for unknown file');
        return;
    }

    const destinationStorageClass =
        record.lifecycleEventData?.transitionEventData?.destinationStorageClass;
    const storageTier = resolveStorageTier(destinationStorageClass);
    if (!storageTier) {
        log.warn(
            { fileId: file.id, s3Key, destinationStorageClass },
            'Lifecycle transition to unmapped storage class'
        );
        return;
    }

    await fileRepo.update(file.id, { storageTier });
    log.info(
        { fileId: file.id, s3Key, storageTier },
        'Storage tier updated from lifecycle transition'
    );
}

async function dispatch(db: DB, record: S3EventRecord): Promise<boolean> {
    const handler = handlers[record.eventName];
    if (!handler) {
        return false;
    }
    await handler(db, record);
    return true;
}

export const s3RestoreService = {
    dispatch,
    expectedUnhandledEvents,
    handledEventTypes,
} as const;
