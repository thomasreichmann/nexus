import type { DB } from '@nexus/db';
import {
    createFileRepo,
    type StorageByCategory,
    type DailyUploadVolume,
} from '@nexus/db/repo/files';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import { resolvePlan, type PlanTier } from './constants';

interface StorageUsage {
    usedBytes: number;
    quotaBytes: number;
    percentage: number;
    fileCount: number;
    planTier: PlanTier;
}

async function getUsage(
    db: DB,
    userId: string,
    sub: Subscription | undefined
): Promise<StorageUsage> {
    const fileRepo = createFileRepo(db);

    const [usedBytes, fileCount] = await Promise.all([
        fileRepo.sumStorageByUser(userId),
        fileRepo.countByUser(userId),
    ]);

    const { quotaBytes, planTier } = resolvePlan(sub);
    const percentage = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

    return {
        usedBytes,
        quotaBytes,
        percentage: Math.min(percentage, 100),
        fileCount,
        planTier,
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
