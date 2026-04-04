import type { DB } from '../connection';
import type {
    SeedResult,
    ScenarioDefinition,
    CustomSeedOptions,
} from './types';
import {
    buildUser,
    buildFiles,
    buildSubscription,
    buildStorageUsage,
    buildRetrievals,
} from './builders';
import { PLAN_LIMITS, withTransaction } from './constants';

// Scenario registry

export const SCENARIO_DEFINITIONS: Record<string, ScenarioDefinition> = {
    powerUser: {
        name: 'Power User',
        description: 'Heavy user with 200 files, pro plan, active retrievals',
        estimates: { users: 1, files: 200, subscriptions: 1, retrievals: 5 },
    },
    emptyUser: {
        name: 'Empty User',
        description: 'New user on trial with no files',
        estimates: { users: 1, files: 0, subscriptions: 1, retrievals: 0 },
    },
    quotaNearLimit: {
        name: 'Quota Near Limit',
        description: 'Starter plan user at 95%+ storage capacity',
        estimates: { users: 1, files: 30, subscriptions: 1, retrievals: 0 },
    },
    mixedTiers: {
        name: 'Mixed Storage Tiers',
        description: 'Files distributed across all storage tiers',
        estimates: { users: 1, files: 50, subscriptions: 1, retrievals: 0 },
    },
    activeRetrievals: {
        name: 'Active Retrievals',
        description: 'User with glacier files being restored',
        estimates: { users: 1, files: 30, subscriptions: 1, retrievals: 8 },
    },
    multiUser: {
        name: 'Multi-User',
        description:
            '5 users with varied profiles (empty, light, medium, heavy, admin)',
        estimates: { users: 5, files: 95, subscriptions: 5, retrievals: 3 },
    },
    fullDemo: {
        name: 'Full Demo',
        description: 'Complete demo environment with all user types and states',
        estimates: { users: 6, files: 325, subscriptions: 6, retrievals: 13 },
    },
};

export type ScenarioName = keyof typeof SCENARIO_DEFINITIONS;

// Scenario implementations

async function powerUser(db: DB): Promise<SeedResult> {
    const user = await buildUser(db, { name: 'Power User' });
    const sub = await buildSubscription(db, user.id, {
        planTier: 'pro',
        status: 'active',
    });
    const files = await buildFiles(db, user.id, {
        count: 200,
        storageTierDistribution: {
            standard: 0.1,
            glacier: 0.6,
            deep_archive: 0.3,
        },
    });
    const glacierFiles = files.filter((f) => f.storageTier !== 'standard');
    const retrievals = await buildRetrievals(
        db,
        user.id,
        glacierFiles.slice(0, 5).map((f) => f.id)
    );
    const usage = await buildStorageUsage(db, user.id);

    return {
        users: [user],
        files,
        subscriptions: [sub],
        retrievals,
        storageUsage: [usage],
    };
}

async function emptyUser(db: DB): Promise<SeedResult> {
    const user = await buildUser(db, { name: 'New User' });
    const sub = await buildSubscription(db, user.id, {
        planTier: 'starter',
        status: 'trialing',
        trialEnd: new Date(Date.now() + 14 * 86_400_000),
    });
    const usage = await buildStorageUsage(db, user.id);

    return {
        users: [user],
        files: [],
        subscriptions: [sub],
        retrievals: [],
        storageUsage: [usage],
    };
}

async function quotaNearLimit(db: DB): Promise<SeedResult> {
    const user = await buildUser(db, { name: 'Quota User' });
    const starterLimit = PLAN_LIMITS.starter; // 10 GB
    const sub = await buildSubscription(db, user.id, {
        planTier: 'starter',
        status: 'active',
    });

    // Create files that sum to ~95% of the starter limit
    const targetBytes = Math.floor(starterLimit * 0.95);
    const avgFileSize = Math.floor(targetBytes / 30);
    const files = await buildFiles(db, user.id, {
        count: 30,
        sizeRange: {
            min: Math.floor(avgFileSize * 0.8),
            max: Math.floor(avgFileSize * 1.2),
        },
    });
    const usage = await buildStorageUsage(db, user.id);

    return {
        users: [user],
        files,
        subscriptions: [sub],
        retrievals: [],
        storageUsage: [usage],
    };
}

async function mixedTiers(db: DB): Promise<SeedResult> {
    const user = await buildUser(db, { name: 'Mixed Tier User' });
    const sub = await buildSubscription(db, user.id, {
        planTier: 'pro',
        status: 'active',
    });
    const files = await buildFiles(db, user.id, {
        count: 50,
        storageTierDistribution: {
            standard: 0.3,
            glacier: 0.5,
            deep_archive: 0.2,
        },
    });
    const usage = await buildStorageUsage(db, user.id);

    return {
        users: [user],
        files,
        subscriptions: [sub],
        retrievals: [],
        storageUsage: [usage],
    };
}

async function activeRetrievals(db: DB): Promise<SeedResult> {
    const user = await buildUser(db, { name: 'Retrieval User' });
    const sub = await buildSubscription(db, user.id, {
        planTier: 'pro',
        status: 'active',
    });
    const files = await buildFiles(db, user.id, {
        count: 30,
        storageTierDistribution: {
            standard: 0.0,
            glacier: 0.7,
            deep_archive: 0.3,
        },
    });
    const retrievals = await buildRetrievals(
        db,
        user.id,
        files.slice(0, 8).map((f) => f.id),
        {
            statusDistribution: {
                pending: 0.25,
                in_progress: 0.25,
                ready: 0.25,
                expired: 0.25,
            },
        }
    );
    const usage = await buildStorageUsage(db, user.id);

    return {
        users: [user],
        files,
        subscriptions: [sub],
        retrievals,
        storageUsage: [usage],
    };
}

async function multiUser(db: DB): Promise<SeedResult> {
    const results: SeedResult[] = [];

    // Empty trial user
    results.push(await emptyUser(db));

    // Light user (5 files)
    const light = await buildUser(db, { name: 'Light User' });
    const lightSub = await buildSubscription(db, light.id, {
        planTier: 'starter',
        status: 'active',
    });
    const lightFiles = await buildFiles(db, light.id, { count: 5 });
    const lightUsage = await buildStorageUsage(db, light.id);
    results.push({
        users: [light],
        files: lightFiles,
        subscriptions: [lightSub],
        retrievals: [],
        storageUsage: [lightUsage],
    });

    // Medium user (40 files)
    const medium = await buildUser(db, { name: 'Medium User' });
    const medSub = await buildSubscription(db, medium.id, {
        planTier: 'pro',
        status: 'active',
    });
    const medFiles = await buildFiles(db, medium.id, { count: 40 });
    const medUsage = await buildStorageUsage(db, medium.id);
    results.push({
        users: [medium],
        files: medFiles,
        subscriptions: [medSub],
        retrievals: [],
        storageUsage: [medUsage],
    });

    // Heavy user (50 files, retrievals)
    const heavy = await buildUser(db, { name: 'Heavy User' });
    const heavySub = await buildSubscription(db, heavy.id, {
        planTier: 'max',
        status: 'active',
    });
    const heavyFiles = await buildFiles(db, heavy.id, { count: 50 });
    const heavyRetrievals = await buildRetrievals(
        db,
        heavy.id,
        heavyFiles.slice(0, 3).map((f) => f.id)
    );
    const heavyUsage = await buildStorageUsage(db, heavy.id);
    results.push({
        users: [heavy],
        files: heavyFiles,
        subscriptions: [heavySub],
        retrievals: heavyRetrievals,
        storageUsage: [heavyUsage],
    });

    // Admin user
    const admin = await buildUser(db, { name: 'Seed Admin', role: 'admin' });
    const adminSub = await buildSubscription(db, admin.id, {
        planTier: 'enterprise',
        status: 'active',
    });
    const adminUsage = await buildStorageUsage(db, admin.id);
    results.push({
        users: [admin],
        files: [],
        subscriptions: [adminSub],
        retrievals: [],
        storageUsage: [adminUsage],
    });

    return mergeResults(results);
}

async function fullDemo(db: DB): Promise<SeedResult> {
    const results: SeedResult[] = [];

    results.push(await multiUser(db));
    results.push(await quotaNearLimit(db));
    results.push(await activeRetrievals(db));

    return mergeResults(results);
}

// Custom seed

export async function customSeed(
    db: DB,
    options: CustomSeedOptions
): Promise<SeedResult> {
    return withTransaction(db, async (tx) => {
        const {
            existingUserId,
            userName = 'Custom User',
            fileCount = 50,
            planTier = 'starter',
            subscriptionStatus = 'active',
            storageTierDistribution,
            retrievalCount = 0,
        } = options;

        let createdUser: SeedResult['users'][0] | undefined;
        let userId: string;
        if (existingUserId) {
            userId = existingUserId;
        } else {
            createdUser = await buildUser(tx, { name: userName });
            userId = createdUser.id;
        }

        const results: SeedResult = {
            users: createdUser ? [createdUser] : [],
            files: [],
            subscriptions: [],
            retrievals: [],
            storageUsage: [],
        };

        if (!existingUserId) {
            const sub = await buildSubscription(tx, userId, {
                planTier,
                status: subscriptionStatus,
            });
            results.subscriptions.push(sub);
        }

        if (fileCount > 0) {
            const files = await buildFiles(tx, userId, {
                count: fileCount,
                storageTierDistribution,
            });
            results.files = files;

            if (retrievalCount > 0) {
                const glacierFiles = files.filter(
                    (f) => f.storageTier !== 'standard'
                );
                const retrievals = await buildRetrievals(
                    tx,
                    userId,
                    glacierFiles.slice(0, retrievalCount).map((f) => f.id),
                    { count: retrievalCount }
                );
                results.retrievals = retrievals;
            }
        }

        const usage = await buildStorageUsage(tx, userId);
        results.storageUsage.push(usage);

        return results;
    });
}

// Scenario runner

const SCENARIO_RUNNERS: Record<string, (db: DB) => Promise<SeedResult>> = {
    powerUser,
    emptyUser,
    quotaNearLimit,
    mixedTiers,
    activeRetrievals,
    multiUser,
    fullDemo,
};

export async function runScenario(db: DB, name: string): Promise<SeedResult> {
    const runner = SCENARIO_RUNNERS[name];
    if (!runner) {
        throw new Error(
            `Unknown scenario: "${name}". Available: ${Object.keys(SCENARIO_RUNNERS).join(', ')}`
        );
    }
    return withTransaction(db, runner);
}

// Helpers

function mergeResults(results: SeedResult[]): SeedResult {
    return {
        users: results.flatMap((r) => r.users),
        files: results.flatMap((r) => r.files),
        subscriptions: results.flatMap((r) => r.subscriptions),
        retrievals: results.flatMap((r) => r.retrievals),
        storageUsage: results.flatMap((r) => r.storageUsage),
    };
}
