import type { DB, Retrieval, File } from '@nexus/db';
import * as fileRepo from '@nexus/db';
import * as retrievalRepo from '@nexus/db';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { s3 } from '@/lib/storage';
import type { RestoreTier } from '@/lib/storage';

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600; // 1 hour

// Only objects stored in Glacier-class tiers can be restored
const GLACIER_TIERS: File['storageTier'][] = ['glacier', 'deep_archive'];

async function requestRetrieval(
    db: DB,
    userId: string,
    fileId: string,
    tier: RestoreTier = 'standard'
): Promise<Retrieval> {
    const retrievals = await requestBulkRetrieval(db, userId, [fileId], tier);
    return retrievals[0];
}

async function requestBulkRetrieval(
    db: DB,
    userId: string,
    fileIds: string[],
    tier: RestoreTier = 'standard'
): Promise<Retrieval[]> {
    const files = await fileRepo.findUserFiles(db, userId, fileIds);
    if (files.length !== fileIds.length) {
        const foundIds = new Set(files.map((f) => f.id));
        const missingId = fileIds.find((id) => !foundIds.has(id));
        throw new NotFoundError('File', missingId!);
    }

    const existingRetrievals = await retrievalRepo.findByFileIds(db, fileIds);
    const existingFileIds = new Set(existingRetrievals.map((r) => r.fileId));

    const filesToRestore = files.filter((f) => !existingFileIds.has(f.id));

    const nonGlacierFile = filesToRestore.find(
        (f) => !GLACIER_TIERS.includes(f.storageTier)
    );
    if (nonGlacierFile) {
        throw new InvalidStateError(
            `File is not in a Glacier storage tier (current: ${nonGlacierFile.storageTier})`
        );
    }

    if (filesToRestore.length > 0) {
        await s3.glacier.restoreMany(
            filesToRestore.map((f) => f.s3Key),
            tier
        );

        const now = new Date();
        const newRetrievals = await retrievalRepo.insertMany(
            db,
            filesToRestore.map((f) => ({
                id: crypto.randomUUID(),
                fileId: f.id,
                userId,
                tier,
                status: 'pending' as const,
                initiatedAt: now,
            }))
        );

        return [...existingRetrievals, ...newRetrievals];
    }

    return existingRetrievals;
}

interface DownloadUrlResult {
    url: string;
    expiresAt: Date;
}

async function getDownloadUrl(
    db: DB,
    userId: string,
    fileId: string
): Promise<DownloadUrlResult> {
    const file = await fileRepo.findUserFile(db, userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    const retrieval = await retrievalRepo.findByFileId(db, fileId);
    if (!retrieval || retrieval.status !== 'ready') {
        throw new InvalidStateError('File retrieval is not ready for download');
    }

    const url = await s3.presigned.get(file.s3Key, {
        expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
        filename: file.name,
    });

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000);

    return { url, expiresAt };
}

export const retrievalService = {
    requestRetrieval,
    requestBulkRetrieval,
    getDownloadUrl,
} as const;
