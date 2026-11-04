import {
    deleteUserData,
    insertFile,
    insertRetrievalSpecs,
    insertStorageUsage,
    insertUploadBatch,
    type RetrievalSpec,
} from '@nexus/db/test-db';
import { daysAgo, hoursAgo } from '@nexus/db/seed';

import { thumbnailAsset, webpSize } from './thumbnails';
import type { Db } from './db';
import type { CaptureUser } from './scene';

const MB = 1024 * 1024;
const GB = 1024 * MB;

interface DemoFile {
    name: string;
    mime: string;
    size: number;
    /** A file in mid-restore renders the `Retrieving` state. */
    status?: 'available' | 'restoring';
    /** Basename of a committed thumbnail under assets/thumbnails; omit for files with no preview. */
    thumb?: string;
    /** Video length, for the duration badge the worker would have probed. */
    durationSeconds?: number;
}

interface Shoot {
    name: string;
    created: Date;
    files: DemoFile[];
}

const CR3 = 'image/x-canon-cr3';
const NEF = 'image/x-nikon-nef';

// Curated marketing data: a photographer's archive, grouped by shoot. The
// thumbnails are real photos (see assets/thumbnails/README.md); the shoot and
// file names are fictional and chosen to match them. Shoots are listed
// newest-first so the most recent sit at the top.
const SHOOTS: Shoot[] = [
    {
        name: 'Client Deliverables — Q4 2026',
        created: daysAgo(3),
        files: [
            {
                name: 'showroom-gallery.zip',
                mime: 'application/zip',
                size: 4.2 * GB,
            },
            {
                name: 'raw-export-batch-04.7z',
                mime: 'application/x-7z-compressed',
                size: 18 * GB,
            },
            {
                name: 'print-ready-tiffs.zip',
                mime: 'application/zip',
                size: 1.1 * GB,
            },
            {
                name: 'contract-signed.pdf',
                mime: 'application/pdf',
                size: 1.4 * MB,
            },
        ],
    },
    {
        name: 'Launch Dinner — Catering',
        created: daysAgo(5),
        files: [
            {
                name: 'rose-tart.CR3',
                mime: CR3,
                size: 31 * MB,
                thumb: 'rose-tart',
            },
            {
                name: 'canapes-cherry.CR3',
                mime: CR3,
                size: 29 * MB,
                status: 'restoring',
                thumb: 'canapes-cherry',
            },
            {
                name: 'passed-bites.CR3',
                mime: CR3,
                size: 27 * MB,
                thumb: 'passed-bites',
            },
            {
                name: 'table-greens.CR3',
                mime: CR3,
                size: 33 * MB,
                thumb: 'table-greens',
            },
            {
                name: 'pastry-table.CR3',
                mime: CR3,
                size: 35 * MB,
                thumb: 'pastry-table',
            },
            {
                name: 'dessert-crumble.CR3',
                mime: CR3,
                size: 30 * MB,
                thumb: 'dessert-crumble',
            },
            {
                name: 'grissini-board.CR3',
                mime: CR3,
                size: 28 * MB,
                thumb: 'grissini-board',
            },
            {
                name: 'glassware-tray.CR3',
                mime: CR3,
                size: 26 * MB,
                thumb: 'glassware-tray',
            },
        ],
    },
    {
        name: 'Showroom Opening — Interiors',
        created: daysAgo(12),
        files: [
            {
                name: 'showroom-lounge-01.NEF',
                mime: NEF,
                size: 46 * MB,
                thumb: 'showroom-lounge-01',
            },
            {
                name: 'showroom-lounge-02.NEF',
                mime: NEF,
                size: 44 * MB,
                thumb: 'showroom-lounge-02',
            },
            {
                name: 'textile-detail.NEF',
                mime: NEF,
                size: 41 * MB,
                thumb: 'textile-detail',
            },
            {
                name: 'striped-cushions.NEF',
                mime: NEF,
                size: 43 * MB,
                thumb: 'striped-cushions',
            },
            {
                name: 'showroom-walkthrough-4k.mp4',
                mime: 'video/mp4',
                size: 3.4 * GB,
                thumb: 'shelving-display',
                durationSeconds: 94,
            },
            {
                name: 'reading-corner-pan.mov',
                mime: 'video/quicktime',
                size: 1.2 * GB,
                thumb: 'reading-corner',
                durationSeconds: 38,
            },
        ],
    },
    {
        name: 'Coffee Tasting — Morning Brunch',
        created: daysAgo(21),
        files: [
            {
                name: 'pour-over-01.CR3',
                mime: CR3,
                size: 32 * MB,
                status: 'restoring',
                thumb: 'pour-over-01',
            },
            {
                name: 'pour-over-02.CR3',
                mime: CR3,
                size: 31 * MB,
                thumb: 'pour-over-02',
            },
            {
                name: 'coffee-break-buffet.CR3',
                mime: CR3,
                size: 34 * MB,
                thumb: 'coffee-break-buffet',
            },
            {
                name: 'brunch-setup-timelapse.mp4',
                mime: 'video/mp4',
                size: 900 * MB,
                thumb: 'brunch-table',
                durationSeconds: 45,
            },
        ],
    },
];

// A mix of retrieval states surfaces the restore UX — the engineering centerpiece.
const RETRIEVALS: RetrievalSpec[] = [
    { file: 'textile-detail.NEF', status: 'ready', init: hoursAgo(14) },
    { file: 'grissini-board.CR3', status: 'ready', init: hoursAgo(9) },
    { file: 'canapes-cherry.CR3', status: 'in_progress', init: hoursAgo(2) },
    { file: 'pour-over-01.CR3', status: 'in_progress', init: hoursAgo(6) },
    { file: 'raw-export-batch-04.7z', status: 'pending', init: hoursAgo(0.3) },
];

/**
 * Seed the curated demo library onto the capture user. Idempotent: clears the
 * user's existing files/batches/retrievals first, so a re-record never doubles
 * up. Recomputes the storage card from the seeded files.
 *
 * Files with a `thumb` are seeded as `ready` with the asset's real size, and
 * their id → asset path is recorded in `thumbnails` so the recorder can serve
 * the image (see serveThumbnails). The rest are `skipped`: no preview, icon tile.
 */
export async function seedDemoLibrary(
    db: Db,
    user: CaptureUser,
    thumbnails: Map<string, string>
): Promise<void> {
    await deleteUserData(db, user.id);
    thumbnails.clear();

    const fileIdByName: Record<string, string> = {};
    let usedBytes = 0;
    let fileCount = 0;

    for (const shoot of SHOOTS) {
        const batch = await insertUploadBatch(db, {
            userId: user.id,
            name: shoot.name,
            createdAt: shoot.created,
            updatedAt: shoot.created,
        });
        for (let i = 0; i < shoot.files.length; i++) {
            const f = shoot.files[i]!;
            // Spread file timestamps within the shoot for a realistic history.
            const createdAt = new Date(
                shoot.created.getTime() + i * 7 * 60_000
            );
            const size = Math.round(f.size);
            const asset = f.thumb ? thumbnailAsset(f.thumb) : undefined;
            const dims = asset ? webpSize(asset) : undefined;
            const file = await insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                name: f.name,
                size,
                mimeType: f.mime,
                status: f.status ?? 'available',
                thumbnailStatus: dims ? 'ready' : 'skipped',
                thumbnailWidth: dims?.width ?? null,
                thumbnailHeight: dims?.height ?? null,
                durationSeconds: f.durationSeconds ?? null,
                createdAt,
                updatedAt: createdAt,
            });
            if (asset) thumbnails.set(file.id, asset);
            fileIdByName[f.name] = file.id;
            usedBytes += size;
            fileCount += 1;
        }
    }

    await insertRetrievalSpecs(db, user.id, fileIdByName, RETRIEVALS);

    await insertStorageUsage(db, { userId: user.id, usedBytes, fileCount });
}
