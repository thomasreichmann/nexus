import type { DB } from '@nexus/db';
import { jobs } from '@/lib/jobs';
import { logger } from '@/server/lib/logger';

const log = logger.child({ service: 'thumbnails' });

/**
 * Enqueue thumbnail generation without ever failing the caller: by the time
 * this runs, the triggering work (upload confirm, restore handling) is
 * already committed, so a broken jobs rail only leaves the row at its
 * current thumbnailStatus — an icon fallback in the UI, not an error.
 * Returns whether the job was actually enqueued.
 */
export async function enqueueThumbnailGeneration(
    db: DB,
    fileId: string
): Promise<boolean> {
    try {
        await jobs.publish(db, {
            type: 'generate-thumbnail',
            payload: { fileId },
        });
        return true;
    } catch (err) {
        log.error({ err, fileId }, 'Failed to enqueue generate-thumbnail');
        return false;
    }
}
