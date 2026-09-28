/**
 * The thumbnail leg's alarm rule (#409), kept apart from the health check
 * that queries for it (`check-s3-event-health.ts`) so its thresholds can be
 * pinned without a database.
 */
import type { ThumbnailStatusCounts } from '@nexus/db/repo/files';

/**
 * One poison file is a bad file, not a broken bucket. The alarm needs both a
 * floor and a majority of the cohort before it calls the pipeline broken.
 */
const MIN_STUCK_THUMBNAILS = 3;
const STUCK_THUMBNAIL_SHARE = 0.5;

export interface ThumbnailHealth {
    /** Uploads in the cohort that should end up with a thumbnail. */
    eligible: number;
    /** Most of the cohort is still 'pending': the pipeline looks broken. */
    isPipelineStuck: boolean;
    /**
     * 'error' for a stuck pipeline, 'info' when the only news is uploads
     * that went 'failed_cold', null when there's nothing to send.
     */
    alertSeverity: 'error' | 'info' | null;
}

/**
 * `cohort`: thumbnail statuses of recent uploads old enough to have finished.
 * `failedColdNew`: how many of them went 'failed_cold' since the last run.
 */
export function assessThumbnailHealth(
    cohort: ThumbnailStatusCounts,
    failedColdNew: number
): ThumbnailHealth {
    // 'skipped' rows (non-media, deleted before the job ran) were never going
    // to get a thumbnail, so they're outside the rate either way.
    const eligible =
        cohort.pending + cohort.ready + cohort.failed + cohort.failed_cold;
    const isPipelineStuck =
        cohort.pending >= MIN_STUCK_THUMBNAILS &&
        cohort.pending / eligible >= STUCK_THUMBNAIL_SHARE;

    let alertSeverity: ThumbnailHealth['alertSeverity'] = null;
    if (isPipelineStuck) alertSeverity = 'error';
    else if (failedColdNew > 0) alertSeverity = 'info';

    return { eligible, isPipelineStuck, alertSeverity };
}
