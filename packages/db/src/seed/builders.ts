import { and, eq, notInArray, sum, count } from 'drizzle-orm';
import * as schema from '../schema';
import {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '../objectState';
import { HIDDEN_STATUSES } from '../repositories/files';
import {
    SEED_USER_PREFIX,
    SEED_FILE_PREFIX,
    SEED_SUB_PREFIX,
    SEED_RETRIEVAL_PREFIX,
    SEED_STORAGE_PREFIX,
    SEED_EMAIL_DOMAIN,
    PLAN_LIMITS,
    ALL_FILE_TEMPLATES,
    seedId,
    randomInt,
    randomPick,
    randomDate,
    hoursAgo,
} from './constants';
import type { DB } from '../connection';
import type {
    User,
    NewUser,
    File,
    Subscription,
    NewSubscription,
    StorageUsage,
    Retrieval,
    FileBuilderOptions,
    RetrievalBuilderOptions,
    RetrievalStatus,
} from './types';

// User builder

export async function buildUser(
    db: DB,
    overrides: Partial<NewUser> = {}
): Promise<User> {
    const id = overrides.id ?? seedId(SEED_USER_PREFIX);
    const name = overrides.name ?? 'Seed User';
    const slugName = name.toLowerCase().replace(/\s+/g, '-');

    const [user] = await db
        .insert(schema.user)
        .values({
            id,
            name,
            email:
                overrides.email ??
                `${slugName}-${id.slice(-8)}@${SEED_EMAIL_DOMAIN}`,
            emailVerified: overrides.emailVerified ?? false,
            image: overrides.image ?? null,
            role: overrides.role ?? 'user',
        })
        .returning();

    return user!;
}

// File builder

// Above the lifecycle floor by construction: a seeded file smaller than it can
// never read as cold however old it is, and pinning the floor here rather than
// repeating a literal means moving `object_size_greater_than` moves the seeds
// with it.
const DEFAULT_SIZE_RANGE = {
    min: LIFECYCLE_TRANSITION_MIN_BYTES + 1,
    max: 500_000_000,
};

/**
 * A creation date far enough back that `isProbablyCold` is certain to say yes,
 * spread over the week before the cutoff so a guaranteed-cold batch doesn't
 * render as N identical timestamps. Deliberately ignores `createdAtRange` —
 * the guarantee is the point, and a caller that wants a specific window
 * shouldn't also be asking for cold files.
 */
function coldCreatedAt(): Date {
    return hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS + randomInt(1, 168));
}

export async function buildFiles(
    db: DB,
    userId: string,
    options: FileBuilderOptions = {}
): Promise<File[]> {
    const {
        count: fileCount = 10,
        sizeRange = DEFAULT_SIZE_RANGE,
        createdAtRange,
        coldCount = 0,
    } = options;

    if (fileCount === 0) return [];

    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 90);
    const dateRange = createdAtRange ?? { from: defaultFrom, to: new Date() };

    const values = Array.from({ length: fileCount }, (_, i) => {
        const id = seedId(SEED_FILE_PREFIX);
        const template = randomPick(ALL_FILE_TEMPLATES);
        const [baseName, mime, templateMin, templateMax] = template;

        // Use template size range if it overlaps with requested range, else use requested
        const effectiveMin = Math.max(sizeRange.min, templateMin);
        const effectiveMax = Math.min(sizeRange.max, templateMax);
        const drawnSize =
            effectiveMin <= effectiveMax
                ? randomInt(effectiveMin, effectiveMax)
                : randomInt(sizeRange.min, sizeRange.max);

        // The first `coldCount` files are cold by construction — size above the
        // lifecycle floor, age past the lag — so a caller that needs N
        // retrievable files gets N, rather than however many a random draw
        // happened to age past the cutoff.
        const isGuaranteedCold = i < coldCount;
        const size = isGuaranteedCold
            ? Math.max(drawnSize, LIFECYCLE_TRANSITION_MIN_BYTES + 1)
            : drawnSize;

        // Add index suffix to avoid duplicate names
        const ext = baseName.includes('.')
            ? baseName.slice(baseName.lastIndexOf('.'))
            : '';
        const stem = baseName.includes('.')
            ? baseName.slice(0, baseName.lastIndexOf('.'))
            : baseName;
        const name = `${stem}-${String(i + 1).padStart(3, '0')}${ext}`;

        const createdAt = isGuaranteedCold
            ? coldCreatedAt()
            : randomDate(dateRange.from, dateRange.to);

        return {
            id,
            userId,
            name,
            size,
            mimeType: mime,
            // Prefixed, not `originalKey()` — see that function's docblock.
            s3Key: `seed/${userId}/${id}`,
            status: 'available' as const,
            createdAt,
            updatedAt: createdAt,
        };
    });

    const files = await db.insert(schema.files).values(values).returning();
    return files;
}

// Subscription builder

export async function buildSubscription(
    db: DB,
    userId: string,
    overrides: Partial<NewSubscription> = {}
): Promise<Subscription> {
    const planTier = overrides.planTier ?? 'starter';
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const [sub] = await db
        .insert(schema.subscriptions)
        .values({
            id: overrides.id ?? seedId(SEED_SUB_PREFIX),
            userId,
            stripeCustomerId:
                overrides.stripeCustomerId ?? `seed_cus_${crypto.randomUUID()}`,
            stripeSubscriptionId:
                overrides.stripeSubscriptionId ??
                `seed_sub_${crypto.randomUUID()}`,
            planTier,
            status: overrides.status ?? 'active',
            storageLimit: overrides.storageLimit ?? PLAN_LIMITS[planTier],
            currentPeriodStart: overrides.currentPeriodStart ?? now,
            currentPeriodEnd: overrides.currentPeriodEnd ?? periodEnd,
            cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
            trialEnd: overrides.trialEnd ?? null,
        })
        .returning();

    return sub!;
}

// Storage usage builder
// Computes actual usage from seeded files in the DB.

export async function buildStorageUsage(
    db: DB,
    userId: string
): Promise<StorageUsage> {
    // Match the runtime "what counts toward usage" filter so seed-derived
    // snapshots agree with what `confirmUpload`/`deleteUserFile` and the
    // 0010_storage_usage_backfill migration produce. The migration keeps its
    // own copy of the list — migrations are immutable history.
    const [stats] = await db
        .select({
            totalBytes: sum(schema.files.size).mapWith(Number),
            fileCount: count(schema.files.id),
        })
        .from(schema.files)
        .where(
            and(
                eq(schema.files.userId, userId),
                notInArray(schema.files.status, HIDDEN_STATUSES)
            )
        );

    const [usage] = await db
        .insert(schema.storageUsage)
        .values({
            id: seedId(SEED_STORAGE_PREFIX),
            userId,
            usedBytes: stats?.totalBytes ?? 0,
            fileCount: stats?.fileCount ?? 0,
        })
        .onConflictDoUpdate({
            target: schema.storageUsage.userId,
            set: {
                usedBytes: stats?.totalBytes ?? 0,
                fileCount: stats?.fileCount ?? 0,
            },
        })
        .returning();

    return usage!;
}

// Retrieval builder

const DEFAULT_RETRIEVAL_STATUS_DIST: Partial<Record<RetrievalStatus, number>> =
    {
        pending: 0.3,
        in_progress: 0.3,
        ready: 0.4,
    };

export async function buildRetrievals(
    db: DB,
    userId: string,
    fileIds: string[],
    options: RetrievalBuilderOptions = {}
): Promise<Retrieval[]> {
    const { count: retrievalCount, statusDistribution } = options;
    const actualCount = Math.min(
        retrievalCount ?? fileIds.length,
        fileIds.length
    );

    if (actualCount === 0) return [];

    const dist = statusDistribution ?? DEFAULT_RETRIEVAL_STATUS_DIST;
    const now = new Date();

    const values = fileIds.slice(0, actualCount).map((fileId, i) => {
        const status = pickRetrievalStatus(dist, i, actualCount);
        const initiatedAt = new Date(
            now.getTime() - randomInt(1, 48) * 3_600_000
        );

        return {
            id: seedId(SEED_RETRIEVAL_PREFIX),
            fileId,
            userId,
            status,
            tier: 'standard' as const,
            initiatedAt,
            readyAt:
                status === 'ready'
                    ? new Date(
                          initiatedAt.getTime() + randomInt(3, 12) * 3_600_000
                      )
                    : null,
            expiresAt:
                status === 'ready'
                    ? new Date(
                          now.getTime() +
                              DEFAULT_RESTORE_DAYS_TO_KEEP * 86_400_000
                      )
                    : null,
            failedAt:
                status === 'failed'
                    ? new Date(
                          initiatedAt.getTime() + randomInt(1, 6) * 3_600_000
                      )
                    : null,
            errorMessage: status === 'failed' ? 'Simulated seed failure' : null,
        };
    });

    const retrievals = await db
        .insert(schema.retrievals)
        .values(values)
        .returning();

    return retrievals;
}

function pickRetrievalStatus(
    distribution: Partial<Record<RetrievalStatus, number>>,
    index: number,
    total: number
): RetrievalStatus {
    const entries = Object.entries(distribution) as [RetrievalStatus, number][];
    const normalizedTotal = entries.reduce((s, [, v]) => s + v, 0);
    let cumulative = 0;

    for (const [status, weight] of entries) {
        cumulative += Math.round((weight / normalizedTotal) * total);
        if (index < cumulative) return status;
    }

    return entries.at(-1)?.[0] ?? 'pending';
}
