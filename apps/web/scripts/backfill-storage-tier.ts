/**
 * Reconcile files.storageTier with the real S3 StorageClass of each object.
 *
 * Rows written before #258 were inserted with the old 'glacier' default and
 * never updated, so the column diverged from reality in both directions:
 * sub-128KB objects stay STANDARD forever (the lifecycle rule skips them),
 * and everything else actually sits in DEEP_ARCHIVE. This lists the bucket
 * once and updates every row whose tier disagrees with S3.
 *
 * Idempotent: a re-run after a clean apply finds no mismatches.
 *
 * Usage:
 *   pnpm -F web backfill:storage-tier          # dry run (default)
 *   pnpm -F web backfill:storage-tier --apply  # actually update rows
 *   pnpm -F web backfill:storage-tier --check  # dry run, exit 1 on drift (CI)
 *
 * `--check` fails on anything that means the DB and the bucket disagree:
 * mismatched tiers, an object-backed row whose object is gone, or a storage
 * class the app doesn't model. It deliberately ignores S3 objects with no row
 * (the bucket also holds keys `files` never tracks) and `uploading` rows with
 * no object (in-flight or abandoned uploads — `reap:stale-uploads` owns those).
 */

import { ne } from 'drizzle-orm';

import { createFileRepo } from '@nexus/db/repo/files';
import { files } from '@nexus/db/schema';
import { alerts, getWorkflowRunUrl } from '@/lib/alerts';
import { db } from '@/server/db';
import { s3 } from '@/lib/storage';
import { resolveStorageTier, type StorageTier } from '@/lib/storage/types';

type FileStatus = (typeof files.status.enumValues)[number];

/**
 * Whether a row in this status is supposed to have an object in the bucket
 * right now. Exhaustive over the enum on purpose: adding a status becomes a
 * type error rather than a silent "not drift", which is the failure mode this
 * script exists to remove (#318).
 */
const HAS_OBJECT: Record<FileStatus, boolean> = {
    available: true,
    restoring: true,
    // The PUT is either in flight or was abandoned by a browser that never
    // came back (#330); `reap:stale-uploads` owns those.
    uploading: false,
    // Filtered out by the query below — the object is already gone.
    deleted: false,
};

async function main(): Promise<void> {
    const shouldApply = process.argv.includes('--apply');
    const isCheck = process.argv.includes('--check');

    // Deleted rows keep their s3Key but the object is already removed —
    // reconciling them would only report every one as missing.
    const rows = await db
        .select({
            id: files.id,
            s3Key: files.s3Key,
            storageTier: files.storageTier,
            status: files.status,
        })
        .from(files)
        .where(ne(files.status, 'deleted'));

    const objects = await s3.objects.listAll();
    const classByKey = new Map(objects.map((o) => [o.key, o.storageClass]));

    const mismatches: {
        id: string;
        s3Key: string;
        from: string;
        to: StorageTier;
    }[] = [];
    let inSync = 0;
    const missing: { s3Key: string; status: FileStatus }[] = [];
    const unmapped: { s3Key: string; storageClass: string | undefined }[] = [];

    for (const row of rows) {
        if (!classByKey.has(row.s3Key)) {
            missing.push({ s3Key: row.s3Key, status: row.status });
            continue;
        }
        const storageClass = classByKey.get(row.s3Key);
        const tier = resolveStorageTier(storageClass);
        if (!tier) {
            unmapped.push({ s3Key: row.s3Key, storageClass });
            continue;
        }
        if (tier === row.storageTier) {
            inSync += 1;
            continue;
        }
        mismatches.push({
            id: row.id,
            s3Key: row.s3Key,
            from: row.storageTier,
            to: tier,
        });
    }

    const rowKeys = new Set(rows.map((r) => r.s3Key));
    const orphans = objects.filter((o) => !rowKeys.has(o.key));

    const missingDrift = missing.filter((m) => HAS_OBJECT[m.status]);
    const missingInFlight = missing.length - missingDrift.length;

    console.log(`DB rows checked:      ${rows.length}`);
    console.log(`Already in sync:      ${inSync}`);
    console.log(`Mismatched tiers:     ${mismatches.length}`);
    console.log(`Missing in S3:        ${missingDrift.length}`);
    console.log(`Missing, uploading:   ${missingInFlight}`);
    console.log(`Unmapped class:       ${unmapped.length}`);
    console.log(`S3 objects w/o row:   ${orphans.length}`);

    for (const m of mismatches) {
        console.log(`  ~ ${m.s3Key}  ${m.from} -> ${m.to}`);
    }
    for (const m of missing) {
        console.log(`  ? ${m.s3Key}  (${m.status} row has no S3 object)`);
    }
    for (const u of unmapped) {
        console.log(`  ! ${u.s3Key}  (unmapped class: ${u.storageClass})`);
    }

    if (isCheck) {
        // Every condition that means DB and bucket disagree, not just the
        // subset --apply can repair. Missing objects and unmapped classes need
        // a human, so they used to pass silently while looking checked (#318).
        const drift = mismatches.length + missingDrift.length + unmapped.length;
        if (drift === 0) {
            console.log('\nNo drift.');
            return;
        }

        const detail =
            `${mismatches.length} tier, ${missingDrift.length} missing, ` +
            `${unmapped.length} unmapped`;
        console.log(
            `\nCheck failed: ${drift} row(s) disagree with S3 (${detail}).`
        );
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            title: 'Storage-tier drift detected',
            message: `${drift} file row(s) disagree with S3 (${detail}).`,
            context: {
                source: 'backfill-storage-tier',
                ...(runUrl && { workflowRun: runUrl }),
            },
        });
        return;
    }

    if (mismatches.length === 0) {
        console.log('\nNothing to update.');
        return;
    }

    if (!shouldApply) {
        console.log('\nDry run (default). Re-run with --apply to update.');
        return;
    }

    console.log('\nUpdating…');
    const fileRepo = createFileRepo(db);
    let ok = 0;
    let failed = 0;
    for (const m of mismatches) {
        try {
            await fileRepo.update(m.id, { storageTier: m.to });
            console.log(`  ✓ ${m.s3Key}  ${m.from} -> ${m.to}`);
            ok += 1;
        } catch (err) {
            console.error(`  ✗ ${m.s3Key} —`, err);
            failed += 1;
        }
    }

    console.log(`\nDone. ${ok} updated, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
}

main()
    .catch((err) => {
        console.error('Backfill aborted:', err);
        process.exitCode = 1;
    })
    // The pooled connection keeps the event loop alive; close it so the
    // script exits instead of hanging after the summary prints.
    .finally(() => db.$client.end());
