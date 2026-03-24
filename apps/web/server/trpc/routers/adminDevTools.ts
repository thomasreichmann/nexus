import { z } from 'zod';
import { TRPCError } from '@trpc/server';
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
import { adminProcedure, router } from '../init';

const scenarioNames = Object.keys(SCENARIO_DEFINITIONS) as [
    string,
    ...string[],
];

function assertNotProduction() {
    if (process.env.NODE_ENV === 'production') {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Dev tools are not available in production',
        });
    }
}

export const devToolsRouter = router({
    /** Seed files/retrievals for the currently logged-in user */
    seedForMe: adminProcedure
        .input(
            z.object({
                fileCount: z.number().min(1).max(1000).default(50),
                storageTierDistribution: z
                    .object({
                        standard: z.number().min(0).max(1).default(0.1),
                        glacier: z.number().min(0).max(1).default(0.6),
                        deep_archive: z.number().min(0).max(1).default(0.3),
                    })
                    .optional(),
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            assertNotProduction();
            const userId = ctx.session.user.id;
            const files = await buildFiles(ctx.db, userId, {
                count: input.fileCount,
                storageTierDistribution: input.storageTierDistribution,
            });

            let retrievalCount = 0;
            if (input.retrievalCount > 0) {
                const glacierFiles = files.filter(
                    (f) => f.storageTier !== 'standard'
                );
                const retrievals = await buildRetrievals(
                    ctx.db,
                    userId,
                    glacierFiles
                        .slice(0, input.retrievalCount)
                        .map((f) => f.id),
                    { count: input.retrievalCount }
                );
                retrievalCount = retrievals.length;
            }

            await buildStorageUsage(ctx.db, userId);

            return { files: files.length, retrievals: retrievalCount };
        }),

    /** Seed files for another existing user */
    seedForUser: adminProcedure
        .input(
            z.object({
                userId: z.string(),
                fileCount: z.number().min(1).max(1000).default(50),
                storageTierDistribution: z
                    .object({
                        standard: z.number().min(0).max(1).default(0.1),
                        glacier: z.number().min(0).max(1).default(0.6),
                        deep_archive: z.number().min(0).max(1).default(0.3),
                    })
                    .optional(),
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            assertNotProduction();
            const files = await buildFiles(ctx.db, input.userId, {
                count: input.fileCount,
                storageTierDistribution: input.storageTierDistribution,
            });

            let retrievalCount = 0;
            if (input.retrievalCount > 0) {
                const glacierFiles = files.filter(
                    (f) => f.storageTier !== 'standard'
                );
                const retrievals = await buildRetrievals(
                    ctx.db,
                    input.userId,
                    glacierFiles
                        .slice(0, input.retrievalCount)
                        .map((f) => f.id),
                    { count: input.retrievalCount }
                );
                retrievalCount = retrievals.length;
            }

            await buildStorageUsage(ctx.db, input.userId);

            return { files: files.length, retrievals: retrievalCount };
        }),

    /** List all users for the user picker dropdown */
    users: adminProcedure.query(async ({ ctx }) => {
        assertNotProduction();
        return listAllUsers(ctx.db);
    }),

    scenarios: router({
        list: adminProcedure.query(() => {
            assertNotProduction();
            return Object.entries(SCENARIO_DEFINITIONS).map(([key, def]) => ({
                key,
                ...def,
            }));
        }),

        run: adminProcedure
            .input(z.object({ scenario: z.enum(scenarioNames) }))
            .mutation(async ({ ctx, input }) => {
                assertNotProduction();
                const result = await runScenario(ctx.db, input.scenario);
                return {
                    users: result.users.length,
                    files: result.files.length,
                    subscriptions: result.subscriptions.length,
                    retrievals: result.retrievals.length,
                };
            }),
    }),

    summary: adminProcedure.query(async ({ ctx }) => {
        assertNotProduction();
        return getSeedSummary(ctx.db);
    }),

    cleanup: router({
        all: adminProcedure.mutation(async ({ ctx }) => {
            assertNotProduction();
            return cleanupAll(ctx.db);
        }),

        files: adminProcedure.mutation(async ({ ctx }) => {
            assertNotProduction();
            return cleanupFiles(ctx.db);
        }),

        /** Remove seed files/retrievals for a specific user (safe for real users) */
        forUser: adminProcedure
            .input(z.object({ userId: z.string() }))
            .mutation(async ({ ctx, input }) => {
                assertNotProduction();
                return cleanupSeedDataForUser(ctx.db, input.userId);
            }),

        /** Shortcut: remove seed files for the current user */
        forMe: adminProcedure.mutation(async ({ ctx }) => {
            assertNotProduction();
            return cleanupSeedDataForUser(ctx.db, ctx.session.user.id);
        }),
    }),

    custom: adminProcedure
        .input(
            z.object({
                existingUserId: z.string().optional(),
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
                storageTierDistribution: z
                    .object({
                        standard: z.number().min(0).max(1).default(0.1),
                        glacier: z.number().min(0).max(1).default(0.6),
                        deep_archive: z.number().min(0).max(1).default(0.3),
                    })
                    .optional(),
                retrievalCount: z.number().min(0).max(50).default(0),
            })
        )
        .mutation(async ({ ctx, input }) => {
            assertNotProduction();
            const result = await customSeed(ctx.db, input);
            return {
                users: result.users.length,
                files: result.files.length,
                subscriptions: result.subscriptions.length,
                retrievals: result.retrievals.length,
            };
        }),
});
