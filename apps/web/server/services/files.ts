import type { DB } from '@/server/db';
import type { File } from '@/server/db/repositories/files';
import * as fileRepo from '@/server/db/repositories/files';
import { NotFoundError, QuotaExceededError } from '@/server/errors';
import { s3 } from '@/lib/storage';

const MAX_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB for MVP
const PRESIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

interface InitiateUploadInput {
    name: string;
    sizeBytes: number;
    mimeType?: string;
}

interface InitiateUploadResult {
    fileId: string;
    uploadUrl: string;
    expiresAt: Date;
}

interface ConfirmUploadResult {
    file: File;
}

async function initiateUpload(
    db: DB,
    userId: string,
    input: InitiateUploadInput
): Promise<InitiateUploadResult> {
    const currentUsage = await fileRepo.sumStorageBytesByUser(db, userId);
    if (currentUsage + input.sizeBytes > MAX_STORAGE_BYTES) {
        throw new QuotaExceededError('Storage quota exceeded');
    }

    const fileId = crypto.randomUUID();
    const s3Key = `${userId}/${fileId}/${input.name}`;

    const uploadUrl = await s3.presigned.put(s3Key, {
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    await fileRepo.insertFile(db, {
        id: fileId,
        userId,
        name: input.name,
        size: input.sizeBytes,
        mimeType: input.mimeType ?? null,
        s3Key,
        status: 'uploading',
    });

    const expiresAt = new Date(
        Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000
    );

    return {
        fileId,
        uploadUrl,
        expiresAt,
    };
}

async function confirmUpload(
    db: DB,
    userId: string,
    fileId: string
): Promise<ConfirmUploadResult> {
    const file = await fileRepo.findUserFile(db, userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    const updated = await fileRepo.updateFile(db, fileId, {
        status: 'available',
    });

    if (!updated) {
        throw new NotFoundError('File', fileId);
    }

    return { file: updated };
}

async function deleteUserFile(
    db: DB,
    userId: string,
    fileId: string
): Promise<File> {
    const file = await fileRepo.findUserFile(db, userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    const deleted = await fileRepo.softDeleteFile(db, fileId);
    if (!deleted) {
        throw new NotFoundError('File', fileId);
    }

    return deleted;
}

async function deleteUserFiles(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<File[]> {
    if (fileIds.length === 0) return [];

    // Verify ownership of all files first
    const files = await fileRepo.findUserFiles(db, userId, fileIds);
    const foundIds = new Set(files.map((f) => f.id));

    // Find which IDs the user doesn't own or don't exist
    const missingIds = fileIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new NotFoundError('File', missingIds[0]);
    }

    // Soft delete all files and return the actual deleted records
    return fileRepo.softDeleteFiles(db, fileIds);
}

export const fileService = {
    initiateUpload,
    confirmUpload,
    deleteUserFile,
    deleteUserFiles,
} as const;
