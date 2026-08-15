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
 * Rows whose key still has an open multipart session are left alone — see the
 * note in main(). This only reaps uploads with nothing left to resume.
 *
 * Idempotent: a re-run after a clean apply finds nothing.
 *
 * Usage:
 *   pnpm -F web reap:stale-uploads          # dry run (default)
 *   pnpm -F web reap:stale-uploads --apply  # delete objects + close rows
 */

import { createFileRepo, STALE_UPLOAD_HOURS } from '@nexus/db/repo/files';
import { db } from '@/server/db';
import { s3 } from '@/lib/storage';
import { fileService } from '@/server/services/files';

async function main(): Promise<void> {
    const shouldApply = process.argv.includes('--apply');

    const staleBefore = new Date(
        Date.now() - STALE_UPLOAD_HOURS * 60 * 60 * 1000
    );
    const found = await createFileRepo(db).findStaleUploads(staleBefore);

    // `findStaleUploads` can't tell the engines apart — the row records no
    // upload ID — so a half-finished multipart upload looks exactly like an
    // abandoned single-part one. Releasing it would DeleteObject a key that
    // holds no object yet (a no-op, the parts survive) and then close the row,
    // stranding a user who still has a resumable record pointing at it. S3's
    // own abort-incomplete-multipart rule reclaims the parts at 7 days; until
    // then an open session means the upload is still alive, so leave it.
    const openMultipart = await s3.multipart.listOpenKeys();
    const stale = found.filter((f) => !openMultipart.has(f.s3Key));
    const skipped = found.length - stale.length;

    const totalBytes = stale.reduce((sum, f) => sum + f.size, 0);
    console.log(`Uploads stuck >${STALE_UPLOAD_HOURS}h:  ${found.length}`);
    console.log(`Still open as multipart (skipped):  ${skipped}`);
    console.log(`Reapable:  ${stale.length}`);
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
