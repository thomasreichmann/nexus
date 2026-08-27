import {
    deleteUserData,
    insertFile,
    insertRetrievalSpecs,
    insertStorageUsage,
    insertUploadBatch,
    type RetrievalSpec,
} from '@nexus/db/test-db';
import { daysAgo, hoursAgo } from '@nexus/db/seed';

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
}

interface Shoot {
    name: string;
    created: Date;
    files: DemoFile[];
}

// Curated marketing data: a photographer's archive, grouped by shoot. Names
// and sizes are hand-picked so the walkthrough reads as a real library, and
// shoots are listed newest-first so the most recent sit at the top.
const SHOOTS: Shoot[] = [
    {
        name: 'Client Deliverables — Q2 2026',
        created: daysAgo(3),
        files: [
            {
                name: 'smith-wedding-gallery.zip',
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
                name: 'contract-marquez-signed.pdf',
                mime: 'application/pdf',
                size: 1.4 * MB,
            },
        ],
    },
    {
        name: 'Marquez Wedding — June 2026',
        created: daysAgo(5),
        files: [
            {
                name: 'ceremony-0148.NEF',
                mime: 'image/x-nikon-nef',
                size: 38 * MB,
            },
            {
                name: 'ceremony-0212.NEF',
                mime: 'image/x-nikon-nef',
                size: 41 * MB,
            },
            {
                name: 'first-dance.NEF',
                mime: 'image/x-nikon-nef',
                size: 36 * MB,
                status: 'restoring',
            },
            {
                name: 'couple-golden-hour.CR2',
                mime: 'image/x-canon-cr2',
                size: 32 * MB,
            },
            {
                name: 'reception-toast.NEF',
                mime: 'image/x-nikon-nef',
                size: 39 * MB,
            },
            {
                name: 'bridal-party.CR2',
                mime: 'image/x-canon-cr2',
                size: 30 * MB,
            },
            {
                name: 'highlights-reel.mov',
                mime: 'video/quicktime',
                size: 1.4 * GB,
            },
            {
                name: 'full-ceremony-4k.mp4',
                mime: 'video/mp4',
                size: 38 * GB,
            },
        ],
    },
    {
        name: 'Studio Portraits — Vol. III',
        created: daysAgo(12),
        files: [
            {
                name: 'headshot-final-01.png',
                mime: 'image/png',
                size: 18 * MB,
            },
            {
                name: 'headshot-final-02.png',
                mime: 'image/png',
                size: 19 * MB,
            },
            {
                name: 'headshot-final-03.png',
                mime: 'image/png',
                size: 21 * MB,
            },
            {
                name: 'editorial-bw-04.tiff',
                mime: 'image/tiff',
                size: 96 * MB,
            },
            {
                name: 'studio-setup-bts.jpg',
                mime: 'image/jpeg',
                size: 8 * MB,
            },
        ],
    },
    {
        name: 'Iceland — Aurora & Glaciers',
        created: daysAgo(21),
        files: [
            {
                name: 'aurora-jokulsarlon-007.CR2',
                mime: 'image/x-canon-cr2',
                size: 34 * MB,
                status: 'restoring',
            },
            {
                name: 'glacier-lagoon-pano.tiff',
                mime: 'image/tiff',
                size: 142 * MB,
            },
            {
                name: 'vestrahorn-dawn.NEF',
                mime: 'image/x-nikon-nef',
                size: 40 * MB,
            },
            {
                name: 'diamond-beach-longexp.CR2',
                mime: 'image/x-canon-cr2',
                size: 33 * MB,
            },
            {
                name: 'highlands-aerial.tiff',
                mime: 'image/tiff',
                size: 118 * MB,
            },
            {
                name: 'northern-lights-timelapse.mp4',
                mime: 'video/mp4',
                size: 54 * GB,
            },
        ],
    },
    {
        name: 'Drone — Big Sur Coastline',
        created: daysAgo(31),
        files: [
            {
                name: 'bigsur-coast-4k-01.mp4',
                mime: 'video/mp4',
                size: 14 * GB,
            },
            {
                name: 'bixby-bridge-sunset.mp4',
                mime: 'video/mp4',
                size: 6.2 * GB,
            },
            {
                name: 'cliffs-aerial-raw.mp4',
                mime: 'video/mp4',
                size: 24 * GB,
            },
            {
                name: 'coastline-pano.tiff',
                mime: 'image/tiff',
                size: 134 * MB,
            },
        ],
    },
];

// A mix of retrieval states surfaces the restore UX — the engineering centerpiece.
const RETRIEVALS: RetrievalSpec[] = [
    { file: 'glacier-lagoon-pano.tiff', status: 'ready', init: hoursAgo(14) },
    { file: 'ceremony-0212.NEF', status: 'ready', init: hoursAgo(9) },
    { file: 'first-dance.NEF', status: 'in_progress', init: hoursAgo(2) },
    {
        file: 'aurora-jokulsarlon-007.CR2',
        status: 'in_progress',
        init: hoursAgo(6),
    },
    { file: 'raw-export-batch-04.7z', status: 'pending', init: hoursAgo(0.3) },
];

/**
 * Seed the curated demo library onto the capture user. Idempotent: clears the
 * user's existing files/batches/retrievals first, so a re-record never doubles
 * up. Recomputes the storage card from the seeded files.
 */
export async function seedDemoLibrary(
    db: Db,
    user: CaptureUser
): Promise<void> {
    await deleteUserData(db, user.id);

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
            const file = await insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                name: f.name,
                size,
                mimeType: f.mime,
                status: f.status ?? 'available',
                createdAt,
                updatedAt: createdAt,
            });
            fileIdByName[f.name] = file.id;
            usedBytes += size;
            fileCount += 1;
        }
    }

    await insertRetrievalSpecs(db, user.id, fileIdByName, RETRIEVALS);

    await insertStorageUsage(db, { userId: user.id, usedBytes, fileCount });
}
