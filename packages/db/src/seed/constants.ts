import type { Connection, DB } from '../connection';
import type { PlanTier } from './types';

// Seed ID prefixes
// All seeded entities use these prefixes so cleanup can target them
// without schema changes.

export const SEED_PREFIX = 'seed_';
export const SEED_USER_PREFIX = 'seed_usr_';
export const SEED_FILE_PREFIX = 'seed_file_';
export const SEED_SUB_PREFIX = 'seed_sub_';
export const SEED_RETRIEVAL_PREFIX = 'seed_ret_';
export const SEED_STORAGE_PREFIX = 'seed_sto_';

export const SEED_EMAIL_DOMAIN = 'seed.nexus.local';

// Plan storage limits

export const PLAN_LIMITS: Record<PlanTier, number> = {
    starter: 10 * 1024 ** 3, //    10 GB
    pro: 100 * 1024 ** 3, //   100 GB
    max: 1024 * 1024 ** 3, // 1,024 GB (1 TB)
    enterprise: 10 * 1024 ** 4, //  10 TB
};

// Realistic file data pools
// Each entry: [filename, mimeType, minBytes, maxBytes]

type FileTemplate = [name: string, mime: string, min: number, max: number];

export const FILE_POOLS: Record<string, FileTemplate[]> = {
    documents: [
        ['quarterly-report-2024.pdf', 'application/pdf', 500_000, 5_000_000],
        ['contract-signed.pdf', 'application/pdf', 200_000, 2_000_000],
        [
            'meeting-notes.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            50_000,
            500_000,
        ],
        [
            'budget-2025.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            100_000,
            3_000_000,
        ],
        [
            'presentation-final.pptx',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            2_000_000,
            20_000_000,
        ],
        ['invoice-march.pdf', 'application/pdf', 100_000, 800_000],
        ['employee-handbook.pdf', 'application/pdf', 1_000_000, 10_000_000],
    ],
    images: [
        ['DSC_0001.NEF', 'image/x-nikon-nef', 20_000_000, 40_000_000],
        ['wedding-photo-001.jpg', 'image/jpeg', 5_000_000, 15_000_000],
        ['product-shoot-raw.CR2', 'image/x-canon-cr2', 25_000_000, 35_000_000],
        ['landscape-panorama.tiff', 'image/tiff', 50_000_000, 150_000_000],
        ['headshot-final.png', 'image/png', 2_000_000, 8_000_000],
        ['scan-receipt-042.jpg', 'image/jpeg', 500_000, 2_000_000],
        ['drone-aerial-4k.jpg', 'image/jpeg', 10_000_000, 25_000_000],
        ['family-portrait.heic', 'image/heic', 3_000_000, 8_000_000],
    ],
    videos: [
        ['project-recording-final.mp4', 'video/mp4', 100_000_000, 500_000_000],
        ['wedding-highlights.mov', 'video/quicktime', 200_000_000, 800_000_000],
        ['drone-footage-raw.mp4', 'video/mp4', 500_000_000, 2_000_000_000],
        ['interview-clip.webm', 'video/webm', 50_000_000, 200_000_000],
        ['security-cam-dec-15.mp4', 'video/mp4', 300_000_000, 1_000_000_000],
    ],
    archives: [
        ['backup-2024-01.tar.gz', 'application/gzip', 50_000_000, 200_000_000],
        ['project-source-v2.zip', 'application/zip', 10_000_000, 100_000_000],
        [
            'database-dump-weekly.sql.gz',
            'application/gzip',
            100_000_000,
            500_000_000,
        ],
        [
            'photos-2023-archive.7z',
            'application/x-7z-compressed',
            200_000_000,
            1_000_000_000,
        ],
    ],
};

/** Flat array of all file templates for random selection */
export const ALL_FILE_TEMPLATES: FileTemplate[] =
    Object.values(FILE_POOLS).flat();

// Helpers

export function seedId(prefix: string): string {
    return `${prefix}${crypto.randomUUID()}`;
}

export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomPick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomDate(from: Date, to: Date): Date {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return new Date(fromMs + Math.random() * (toMs - fromMs));
}

export async function withTransaction<T>(
    db: DB,
    fn: (tx: DB) => Promise<T>
): Promise<T> {
    if ('transaction' in db) return (db as Connection).transaction(fn);
    return fn(db);
}
