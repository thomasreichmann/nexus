import { describe, expect, it } from 'vitest';
import { assessThumbnailHealth } from './thumbnailHealth';
import type { ThumbnailStatusCounts } from '@nexus/db/repo/files';

function cohort(counts: Partial<ThumbnailStatusCounts>): ThumbnailStatusCounts {
    return {
        pending: 0,
        ready: 0,
        failed: 0,
        failed_cold: 0,
        skipped: 0,
        ...counts,
    };
}

describe('assessThumbnailHealth', () => {
    describe('the stuck-pipeline alarm', () => {
        it('fires at 3 pending when they are exactly half the cohort', () => {
            const health = assessThumbnailHealth(
                cohort({ pending: 3, ready: 3 }),
                0
            );

            expect(health.isPipelineStuck).toBe(true);
        });

        it('stays quiet at 2 pending, even when that is the whole cohort', () => {
            const health = assessThumbnailHealth(cohort({ pending: 2 }), 0);

            expect(health.isPipelineStuck).toBe(false);
        });

        it('stays quiet when the pending share is just under half', () => {
            const health = assessThumbnailHealth(
                cohort({ pending: 3, ready: 4 }),
                0
            );

            expect(health.isPipelineStuck).toBe(false);
        });

        it('counts failed and failed_cold uploads in the cohort', () => {
            // 3 of 7 pending. Leaving either failure status out would make it
            // 3 of 6 or 3 of 4: half or more.
            const health = assessThumbnailHealth(
                cohort({ pending: 3, failed: 1, failed_cold: 3 }),
                0
            );

            expect(health).toMatchObject({
                eligible: 7,
                isPipelineStuck: false,
            });
        });

        it('leaves skipped uploads out of the cohort', () => {
            // Non-media files never get a thumbnail. Counting them would bury
            // 3 stuck of 4 under a library of PDFs.
            const health = assessThumbnailHealth(
                cohort({ pending: 3, ready: 1, skipped: 100 }),
                0
            );

            expect(health).toMatchObject({
                eligible: 4,
                isPipelineStuck: true,
            });
        });
    });

    describe('which alert goes out', () => {
        it('sends an error for a stuck pipeline, whatever went failed_cold', () => {
            const health = assessThumbnailHealth(cohort({ pending: 3 }), 2);

            expect(health.alertSeverity).toBe('error');
        });

        it('sends info when a single upload went failed_cold and nothing is stuck', () => {
            const health = assessThumbnailHealth(cohort({ ready: 10 }), 1);

            expect(health.alertSeverity).toBe('info');
        });

        it('sends nothing when nothing is stuck and nothing went failed_cold', () => {
            const health = assessThumbnailHealth(
                cohort({ pending: 2, ready: 10 }),
                0
            );

            expect(health.alertSeverity).toBeNull();
        });
    });
});
