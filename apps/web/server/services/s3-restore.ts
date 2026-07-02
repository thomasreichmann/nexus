import type { DB } from '@nexus/db';
import { createFileRepo, type File } from '@nexus/db/repo/files';
import { createRetrievalRepo, type Retrieval } from '@nexus/db/repo/retrievals';
import { env } from '@/lib/env';
import { emailService } from '@/server/services/email';
import { logger } from '@/server/lib/logger';
import type { S3EventRecord } from '@/lib/sns/types';

const log = logger.child({ service: 's3-restore' });

type S3RestoreEventHandler = (db: DB, record: S3EventRecord) => Promise<void>;

const handlers: Record<string, S3RestoreEventHandler> = {
    's3:ObjectRestore:Completed': handleRestoreCompleted,
    's3:ObjectRestore:Delete': handleRestoreExpired,
};

// S3 encodes spaces as `+` in event notification keys
function decodeS3Key(record: S3EventRecord): string {
    return decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
}

async function resolveRetrieval(
    db: DB,
    record: S3EventRecord,
    context: string
): Promise<{ file: File; retrieval: Retrieval } | null> {
    const fileRepo = createFileRepo(db);
    const retrievalRepo = createRetrievalRepo(db);

    const s3Key = decodeS3Key(record);
    const file = await fileRepo.findByS3Key(s3Key);
    if (!file) {
        log.warn({ s3Key }, `${context} for unknown file`);
        return null;
    }

    const retrieval = await retrievalRepo.findByFileId(file.id);
    if (!retrieval) {
        log.warn(
            { fileId: file.id, s3Key },
            `No active retrieval for ${context}`
        );
        return null;
    }

    return { file, retrieval };
}

async function handleRestoreCompleted(
    db: DB,
    record: S3EventRecord
): Promise<void> {
    const result = await resolveRetrieval(db, record, 'restore completed');
    if (!result) return;

    const { file, retrieval } = result;
    const retrievalRepo = createRetrievalRepo(db);
    const now = new Date();
    const expiresAt = record.glacierEventData?.restoreEventData
        ?.lifecycleRestorationExpiryTime
        ? new Date(
              record.glacierEventData.restoreEventData
                  .lifecycleRestorationExpiryTime
          )
        : undefined;

    await retrievalRepo.updateStatus(retrieval.id, 'ready', {
        readyAt: now,
        expiresAt,
    });

    log.info(
        { fileId: file.id, retrievalId: retrieval.id, expiresAt },
        'Retrieval marked as ready'
    );

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
    const result = await resolveRetrieval(db, record, 'restore expiry');
    if (!result) return;

    const { file, retrieval } = result;
    const retrievalRepo = createRetrievalRepo(db);
    await retrievalRepo.updateStatus(retrieval.id, 'expired');

    log.info(
        { fileId: file.id, retrievalId: retrieval.id },
        'Retrieval marked as expired'
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
} as const;
