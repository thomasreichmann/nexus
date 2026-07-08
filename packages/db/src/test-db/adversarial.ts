/**
 * Adversarial seed — a realistic-but-hostile account state for bug repros
 * (#312). An empty account hides data-dependent bugs (the #311 mobile
 * overflow read as "can't reproduce" on a fresh user), so repro specs seed
 * this library first and then drive the UI.
 *
 * The dataset is deterministic — no randomness; timestamps are relative to
 * now, but content and ordering are fixed, so a failing repro fails the
 * same way on re-run. It is curated to hit the rendering edge cases past
 * sessions hand-rolled one-off: long unbreakable filenames (underscores and
 * separator-free runs give CSS no break opportunity), unicode/emoji/CJK
 * names, enough rows to scroll, zero-byte / no-extension / multi-TB sizes,
 * every storage tier and file status (including one soft-deleted row that
 * must NOT render), null mimeType, duplicate names across batches, and
 * retrievals in each active state.
 *
 * Data shape follows tooling/capture's photographer demo seed
 * (tooling/capture/src/seed.ts); this variant trades marketing polish for
 * edge-case coverage. Idempotent: clears the user's data first, so a re-run
 * never doubles up.
 */
import { insertFile, insertStorageUsage, insertUploadBatch } from './inserts';
import { deleteUserData } from './queries';
import { insertRetrievalSpecs, type RetrievalSpec } from './scenarios';
import type { DB } from '../connection';
import type { File } from '../repositories/files';
import type { UploadBatch } from '../repositories/uploadBatches';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;
const daysAgo = (d: number): Date => new Date(Date.now() - d * 86_400_000);
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000);

interface AdversarialFile {
    name: string;
    mime: string | null;
    size: number;
    tier: 'standard' | 'glacier' | 'deep_archive';
    status?: 'uploading' | 'available' | 'restoring' | 'deleted';
}

interface AdversarialBatch {
    name: string;
    created: Date;
    files: AdversarialFile[];
}

// The worst-case filename class from #311: long, and unbreakable because
// underscores (unlike hyphens) create no CSS line-break opportunity.
const LONG_UNBREAKABLE_NAME =
    'Wedding_Marquez_2026_Ceremony_Processional_Cathedral_Wide_Angle_Master_0847_final_retouched_v3_full_resolution_export_KEEP.jpg';

const BATCHES: AdversarialBatch[] = [
    {
        // Newest batch: its files top every newest-first list, so the
        // hostile names land in "recent" widgets, not just the full table.
        name: 'Casamento Marquez — Catedral da Sé, São Paulo — Junho 2026 (Seleção Final + RAW Completo)',
        created: daysAgo(1),
        files: [
            {
                name: LONG_UNBREAKABLE_NAME,
                mime: 'image/jpeg',
                size: 48 * MB,
                tier: 'standard',
            },
            {
                // Separator-free run — not even an underscore to hint at.
                name: 'IMG20260613140000BURST000123456789COVERTOPENHANCEDSTABILIZED.CR2',
                mime: 'image/x-canon-cr2',
                size: 41 * MB,
                tier: 'standard',
            },
            {
                name: 'Ensaio_Pré-Wedding_São_Paulo_—_Fernanda_&_João_Fotos_Selecionadas_Alta_Resolução_0234.NEF',
                mime: 'image/x-nikon-nef',
                size: 39 * MB,
                tier: 'glacier',
            },
            {
                name: '東京タワー夜景撮影会2026年6月13日完全版パノラマ合成最終書き出し.tiff',
                mime: 'image/tiff',
                size: 141 * MB,
                tier: 'glacier',
            },
            {
                name: "🎞️📷 Hawai'i — dia 3 (RAW) ✨.dng",
                mime: 'image/x-adobe-dng',
                size: 27 * MB,
                tier: 'standard',
            },
            {
                name: 'full-ceremony-4k-master.mp4',
                mime: 'video/mp4',
                size: 1.2 * TB,
                tier: 'deep_archive',
            },
            { name: 'notes.txt', mime: null, size: 0, tier: 'standard' },
            { name: 'clipboard', mime: null, size: 1, tier: 'standard' },
            {
                name: 'preview_export_temp.jpg',
                mime: 'image/jpeg',
                size: 3 * MB,
                tier: 'standard',
                status: 'uploading',
            },
            {
                name: 'ceremony-0148.NEF',
                mime: 'image/x-nikon-nef',
                size: 38 * MB,
                tier: 'glacier',
            },
        ],
    },
    {
        // Volume: a camera burst, enough rows to force scrolling/pagination.
        name: 'Burst — Reception Dance Floor (all frames, cull later)',
        created: daysAgo(6),
        files: [
            ...Array.from({ length: 24 }, (_, i): AdversarialFile => {
                const frame = String(4501 + i);
                return {
                    name: `_MG_${frame}.CR2`,
                    mime: 'image/x-canon-cr2',
                    size: (30 + (i % 12)) * MB,
                    tier: 'glacier',
                    status: i === 3 ? 'restoring' : 'available',
                };
            }),
            // Duplicate of a batch-1 filename: lists must key on id, not name.
            {
                name: 'ceremony-0148.NEF',
                mime: 'image/x-nikon-nef',
                size: 37 * MB,
                tier: 'glacier',
            },
        ],
    },
    {
        name: 'Arquivo Morto — Backups 2019–2024 (HDs antigos consolidados — NÃO APAGAR)',
        created: daysAgo(30),
        files: [
            {
                name: 'backup-hd-seagate-2019-full.img',
                mime: 'application/octet-stream',
                size: 2 * TB,
                tier: 'deep_archive',
            },
            {
                name: 'aurora-jokulsarlon-007.CR2',
                mime: 'image/x-canon-cr2',
                size: 34 * MB,
                tier: 'deep_archive',
                status: 'restoring',
            },
            {
                name: 'lightroom-catalog-2021.lrcat',
                mime: null,
                size: 4 * GB,
                tier: 'deep_archive',
            },
            {
                // Soft-deleted: must not render anywhere; a list that shows
                // it (or counts it) has a filtering bug.
                name: 'DELETED_should_never_render.raw',
                mime: null,
                size: 9 * MB,
                tier: 'deep_archive',
                status: 'deleted',
            },
        ],
    },
];

// Ungrouped files (no batch) — the files page renders these in a separate
// section; an account with only batched files never exercises it.
const UNGROUPED: AdversarialFile[] = [
    {
        name: 'contrato-assinado-marquez.pdf',
        mime: 'application/pdf',
        size: 1.4 * MB,
        tier: 'standard',
    },
    {
        name: 'invoice — final (1) (1) copy FINAL v2 [aprovado].pdf',
        mime: 'application/pdf',
        size: 800 * 1024,
        tier: 'standard',
    },
];

// One retrieval per active state, against batch-3/burst files.
const RETRIEVALS: RetrievalSpec[] = [
    {
        file: 'lightroom-catalog-2021.lrcat',
        status: 'ready',
        init: hoursAgo(14),
    },
    {
        file: 'aurora-jokulsarlon-007.CR2',
        status: 'in_progress',
        init: hoursAgo(6),
    },
    { file: '_MG_4504.CR2', status: 'in_progress', init: hoursAgo(2) },
    {
        file: 'backup-hd-seagate-2019-full.img',
        status: 'pending',
        init: hoursAgo(0.3),
    },
];

export interface AdversarialLibrary {
    batches: UploadBatch[];
    files: File[];
    /**
     * The newest file — the long unbreakable filename. Specs wait on this
     * name being visible before measuring, so they never assert against a
     * half-rendered page.
     */
    longNameFile: File;
}

/**
 * Seeds the adversarial library onto `userId`. Clears the user's existing
 * files/batches/retrievals first (idempotent). Writes a consistent
 * storage_usage row computed from the non-deleted files — note #311's
 * gotcha: the dashboard counters read storage_usage while the tables read
 * files, so an inconsistent pair can mask data-dependent bugs.
 */
export async function seedAdversarialLibrary(
    db: DB,
    userId: string
): Promise<AdversarialLibrary> {
    await deleteUserData(db, userId);

    const batches: UploadBatch[] = [];
    const files: File[] = [];
    const fileIdByName: Record<string, string> = {};
    let usedBytes = 0;
    let fileCount = 0;

    const insertOne = async (
        f: AdversarialFile,
        batchId: string | null,
        createdAt: Date
    ) => {
        const size = Math.round(f.size);
        const status = f.status ?? 'available';
        const file = await insertFile(db, {
            userId,
            batchId,
            name: f.name,
            size,
            mimeType: f.mime,
            storageTier: f.tier,
            status,
            createdAt,
            updatedAt: createdAt,
            deletedAt: status === 'deleted' ? createdAt : null,
        });
        files.push(file);
        fileIdByName[f.name] ??= file.id;
        if (status !== 'deleted') {
            usedBytes += size;
            fileCount += 1;
        }
        return file;
    };

    for (const b of BATCHES) {
        const batch = await insertUploadBatch(db, {
            userId,
            name: b.name,
            createdAt: b.created,
            updatedAt: b.created,
        });
        batches.push(batch);
        for (let i = 0; i < b.files.length; i++) {
            // Descending within the batch: the first-listed (nastiest)
            // file is the newest, so newest-first widgets surface it.
            const createdAt = new Date(b.created.getTime() - i * 7 * 60_000);
            await insertOne(b.files[i]!, batch.id, createdAt);
        }
    }
    for (let i = 0; i < UNGROUPED.length; i++) {
        await insertOne(UNGROUPED[i]!, null, daysAgo(2 + i));
    }

    await insertRetrievalSpecs(db, userId, fileIdByName, RETRIEVALS);

    await insertStorageUsage(db, { userId, usedBytes, fileCount });

    const longNameFile = files.find((f) => f.name === LONG_UNBREAKABLE_NAME)!;
    return { batches, files, longNameFile };
}
