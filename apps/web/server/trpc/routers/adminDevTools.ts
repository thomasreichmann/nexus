import { z } from 'zod';
import type { DB } from '@nexus/db';
import {
    SCENARIO_DEFINITIONS,
    buildFiles,
    buildRetrievals,
    buildStorageUsage,
    runScenario,
    customSeed,
    getSeedSummary,
    listAllUsers,
    cleanupAll,
    cleanupFiles,
    cleanupSeedDataForUser,
} from '@nexus/db/seed';
import { devToolsProcedure, router } from '../init';

const scenarioNames = Object.keys(SCENARIO_DEFINITIONS) as [
    string,
    ...string[],
];

const storageTierDistributionSchema = z
    .object({
        standard: z.number().min(0).max(1).default(0.1),
        glacier: z.number().min(0).max(1).default(0.6),
        deep_archive: z.number().min(0).max(1).default(0.3),
    })
    .optional();

async function seedUserFiles(
    db: DB,
    userId: string,
    input: {
        fileCount: number;
        storageTierDistribution?: {
            standard: number;
            glacier: number;
            deep_archive: number;
        };
        retrievalCount: number;
    }
): Promise<{ files: number; retrievals: number }> {
    const files = await buildFiles(db, userId, {
        count: input.fileCount,
        storageTierDistribution: input.storageTierDistribution,
    });

    let retrievalCount = 0;
    if (input.retrievalCount > 0) {
        const glacierFiles = files.filter((f) => f.storageTier !== 'standard');
        const retrievals = await buildRetrievals(
            db,
            userId,
            glacierFiles.slice(0, input.retrievalCount).map((f) => f.id),
            { count: input.retrievalCount }
        );
        retrievalCount = retrievals.length;
    }

    await buildStorageUsage(db, userId);

    return { files: files.length, retrievals: retrievalCount };
}

export const devToolsRouter = router({
    /** Seed files/retrievals for the currently logged-in user */
    seedForMe: devToolsProcedure
        .input(
            z.object({
                fileCount: z.number().min(1).max(1000).default(50),
                storageTierDistribution: storageTierDistributionSchema,
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            return seedUserFiles(ctx.db, ctx.session.user.id, input);
        }),

    /** Seed files for another existing user */
    seedForUser: devToolsProcedure
        .input(
            z.object({
                userId: z.string().uuid(),
                fileCount: z.number().min(1).max(1000).default(50),
                storageTierDistribution: storageTierDistributionSchema,
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            return seedUserFiles(ctx.db, input.userId, input);
        }),

    /** List all users for the user picker dropdown */
    users: devToolsProcedure.query(async ({ ctx }) => {
        return listAllUsers(ctx.db);
    }),

    scenarios: router({
        list: devToolsProcedure.query(() => {
            return Object.entries(SCENARIO_DEFINITIONS).map(([key, def]) => ({
                key,
                ...def,
            }));
        }),

        run: devToolsProcedure
            .input(z.object({ scenario: z.enum(scenarioNames) }))
            .mutation(async ({ ctx, input }) => {
                const result = await runScenario(ctx.db, input.scenario);
                return {
                    users: result.users.length,
                    files: result.files.length,
                    subscriptions: result.subscriptions.length,
                    retrievals: result.retrievals.length,
                };
            }),
    }),

    summary: devToolsProcedure.query(async ({ ctx }) => {
        return getSeedSummary(ctx.db);
    }),

    cleanup: router({
        all: devToolsProcedure.mutation(async ({ ctx }) => {
            return cleanupAll(ctx.db);
        }),

        files: devToolsProcedure.mutation(async ({ ctx }) => {
            return cleanupFiles(ctx.db);
        }),

        /** Remove seed files/retrievals for a specific user (safe for real users) */
        forUser: devToolsProcedure
            .input(z.object({ userId: z.string().uuid() }))
            .mutation(async ({ ctx, input }) => {
                return cleanupSeedDataForUser(ctx.db, input.userId);
            }),

        /** Shortcut: remove seed files for the current user */
        forMe: devToolsProcedure.mutation(async ({ ctx }) => {
            return cleanupSeedDataForUser(ctx.db, ctx.session.user.id);
        }),
    }),

    custom: devToolsProcedure
        .input(
            z.object({
                existingUserId: z.string().uuid().optional(),
                userName: z.string().optional(),
                fileCount: z.number().min(0).max(1000).default(50),
                planTier: z
                    .enum(['starter', 'pro', 'max', 'enterprise'])
                    .default('starter'),
                subscriptionStatus: z
                    .enum([
                        'trialing',
                        'active',
                        'past_due',
                        'canceled',
                        'unpaid',
                        'incomplete',
                    ])
                    .default('active'),
                storageTierDistribution: storageTierDistributionSchema,
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const result = await customSeed(ctx.db, input);
            return {
                users: result.users.length,
                files: result.files.length,
                subscriptions: result.subscriptions.length,
                retrievals: result.retrievals.length,
            };
        }),
});
