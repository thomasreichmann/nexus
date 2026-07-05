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
 */

import { ne } from 'drizzle-orm';

import { db } from '@/server/db';
import { s3 } from '@/lib/storage';
import { resolveStorageTier, type StorageTier } from '@/lib/storage/types';
import { createFileRepo } from '@nexus/db/repo/files';
import { files } from '@nexus/db/schema';

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
    const missing: string[] = [];
    const unmapped: { s3Key: string; storageClass: string | undefined }[] = [];

    for (const row of rows) {
        if (!classByKey.has(row.s3Key)) {
            missing.push(row.s3Key);
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

    console.log(`DB rows checked:      ${rows.length}`);
    console.log(`Already in sync:      ${inSync}`);
    console.log(`Mismatched tiers:     ${mismatches.length}`);
    console.log(`Missing in S3:        ${missing.length}`);
    console.log(`Unmapped class:       ${unmapped.length}`);
    console.log(`S3 objects w/o row:   ${orphans.length}`);

    for (const m of mismatches) {
        console.log(`  ~ ${m.s3Key}  ${m.from} -> ${m.to}`);
    }
    for (const key of missing) {
        console.log(`  ? ${key}  (row has no S3 object)`);
    }
    for (const u of unmapped) {
        console.log(`  ! ${u.s3Key}  (unmapped class: ${u.storageClass})`);
    }

    if (mismatches.length === 0) {
        console.log('\nNothing to update.');
        return;
    }

    if (isCheck) {
        console.log('\nCheck failed: storage tiers have drifted from S3.');
        process.exitCode = 1;
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
