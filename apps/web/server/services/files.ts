import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DB } from '@/server/db';
import * as schema from '@/server/db/schema';
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

// Overload signatures
function deleteUserFile(db: DB, userId: string, fileId: string): Promise<File>;
function deleteUserFile(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<File[]>;
async function deleteUserFile(
    db: DB,
    userId: string,
    fileIdOrIds: string | string[]
): Promise<File | File[]> {
    const fileIds = Array.isArray(fileIdOrIds) ? fileIdOrIds : [fileIdOrIds];
    if (fileIds.length === 0) return [];

    const deleted = await db.transaction(async (tx) => {
        // Single atomic query: ownership check baked into WHERE clause
        const result = await tx
            .update(schema.files)
            .set({
                status: 'deleted',
                deletedAt: new Date(),
            })
            .where(
                and(
                    inArray(schema.files.id, fileIds),
                    eq(schema.files.userId, userId),
                    ne(schema.files.status, 'deleted')
                )
            )
            .returning();

        // If count doesn't match, some files were missing or not owned
        if (result.length !== fileIds.length) {
            const deletedIds = new Set(result.map((f) => f.id));
            const missingId = fileIds.find((id) => !deletedIds.has(id));
            throw new NotFoundError('File', missingId!);
        }

        return result;
    });

    return Array.isArray(fileIdOrIds) ? deleted : deleted[0];
}

export const fileService = {
    initiateUpload,
    confirmUpload,
    deleteUserFile,
} as const;
