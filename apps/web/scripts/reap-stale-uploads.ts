/**
 * Release uploads abandoned mid-flight: delete the object at each row's
 * recorded key and close the row.
 *
 * The client cleans up after itself on cancel/clear/retry since #330, but rows
 * stranded before that fix — and anything a browser that never came back
 * leaves behind — need a sweep. An `uploading` row is hidden from every list
 * and every usage total, so whatever bytes reached S3 are billed and invisible.
 * The nightly `check:s3-event-health` flags them off the same query and
 * threshold; this clears them.
 *
 * Nothing to decrement: usage increments at confirm, so an `uploading` row was
 * never counted. DeleteObject is idempotent, so a row whose PUT never landed
 * costs one no-op call.
 *
 * Idempotent: a re-run after a clean apply finds nothing.
 *
 * Usage:
 *   pnpm -F web reap:stale-uploads          # dry run (default)
 *   pnpm -F web reap:stale-uploads --apply  # delete objects + close rows
 */

import { db } from '@/server/db';
import { fileService } from '@/server/services/files';
import { createFileRepo, STALE_UPLOAD_HOURS } from '@nexus/db/repo/files';

async function main(): Promise<void> {
    const shouldApply = process.argv.includes('--apply');

    const staleBefore = new Date(
        Date.now() - STALE_UPLOAD_HOURS * 60 * 60 * 1000
    );
    const stale = await createFileRepo(db).findStaleUploads(staleBefore);

    const totalBytes = stale.reduce((sum, f) => sum + f.size, 0);
    console.log(`Uploads stuck >${STALE_UPLOAD_HOURS}h:  ${stale.length}`);
    console.log(`Bytes claimed by them:  ${totalBytes}`);
    for (const file of stale) {
        console.log(
            `  ~ ${file.createdAt.toISOString()}  ${file.size}B  file=${file.id} user=${file.userId} key=${file.s3Key}`
        );
    }

    if (stale.length === 0) {
        console.log('\nNothing to reap.');
        return;
    }

    if (!shouldApply) {
        console.log(
            '\nDry run (default). Re-run with --apply to delete the objects and close the rows.'
        );
        return;
    }

    console.log('\nReaping…');
    let ok = 0;
    let failed = 0;
    for (const file of stale) {
        try {
            // The same procedure the client calls on cancel, scoped to the
            // row's own owner — one definition of "release an upload", and it
            // carries the guard that refuses to touch a confirmed file.
            await fileService.abandonUpload(db, file.userId, file.id);
            console.log(`  ✓ ${file.s3Key}`);
            ok += 1;
        } catch (err) {
            console.error(`  ✗ ${file.s3Key} —`, err);
            failed += 1;
        }
    }

    console.log(`\nDone. ${ok} reaped, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
}

main()
    .catch((err) => {
        console.error('Reap aborted:', err);
        process.exitCode = 1;
    })
    // The pooled connection keeps the event loop alive; close it so the
    // script exits instead of hanging after the summary prints.
    .finally(() => db.$client.end());
