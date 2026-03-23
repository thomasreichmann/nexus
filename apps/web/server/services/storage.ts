import type { DB } from '@nexus/db';
import {
    createFileRepo,
    type StorageByCategory,
    type DailyUploadVolume,
} from '@nexus/db/repo/files';
import { createSubscriptionRepo } from '@nexus/db/repo/subscriptions';
import { DEFAULT_STORAGE_LIMIT_BYTES } from './constants';

interface StorageUsage {
    usedBytes: number;
    quotaBytes: number;
    percentage: number;
    fileCount: number;
    planTier: string;
}

async function getUsage(db: DB, userId: string): Promise<StorageUsage> {
    const fileRepo = createFileRepo(db);
    const subscriptionRepo = createSubscriptionRepo(db);

    const [usedBytes, fileCount, sub] = await Promise.all([
        fileRepo.sumStorageByUser(userId),
        fileRepo.countByUser(userId),
        subscriptionRepo.findByUserId(userId),
    ]);

    const quotaBytes = sub?.storageLimit ?? DEFAULT_STORAGE_LIMIT_BYTES;
    const percentage = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

    return {
        usedBytes,
        quotaBytes,
        percentage: Math.min(percentage, 100),
        fileCount,
        planTier: sub?.planTier ?? 'starter',
    };
}

async function getByType(db: DB, userId: string): Promise<StorageByCategory[]> {
    const fileRepo = createFileRepo(db);
    return fileRepo.sumStorageByMimeCategory(userId);
}

async function getUploadHistory(
    db: DB,
    userId: string
): Promise<DailyUploadVolume[]> {
    const fileRepo = createFileRepo(db);
    return fileRepo.uploadHistoryByDay(userId, 30);
}

export const storageService = {
    getUsage,
    getByType,
    getUploadHistory,
} as const;
