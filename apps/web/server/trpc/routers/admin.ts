import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
    createJobRepo,
    type JobType,
    type SqsMessageBody,
} from '@nexus/db/repo/jobs';
import { sendToQueue } from '@/lib/jobs/publish';
import { adminProcedure, router } from '../init';

const jobStatusSchema = z.enum([
    'pending',
    'processing',
    'completed',
    'failed',
]);

export const adminRouter = router({
    jobs: router({
        list: adminProcedure
            .input(
                z
                    .object({
                        limit: z.number().min(1).max(100).default(20),
                        offset: z.number().min(0).default(0),
                        status: jobStatusSchema.optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const jobRepo = createJobRepo(ctx.db);
                const limit = input?.limit ?? 20;
                const offset = input?.offset ?? 0;

                const result = await jobRepo.findMany({
                    limit,
                    offset,
                    status: input?.status,
                });

                return {
                    jobs: result.jobs,
                    total: result.total,
                    hasMore: offset + result.jobs.length < result.total,
                };
            }),

        counts: adminProcedure.query(({ ctx }) => {
            const jobRepo = createJobRepo(ctx.db);
            return jobRepo.countByStatus();
        }),

        retry: adminProcedure
            .input(z.object({ id: z.string().uuid() }))
            .mutation(async ({ ctx, input }) => {
                const jobRepo = createJobRepo(ctx.db);
                const job = await jobRepo.findById(input.id);

                if (!job) {
                    throw new TRPCError({ code: 'NOT_FOUND' });
                }

                if (job.status !== 'failed') {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Only failed jobs can be retried',
                    });
                }

                const updated = await jobRepo.update(input.id, {
                    status: 'pending',
                    error: null,
                    startedAt: null,
                    completedAt: null,
                    attempts: 0,
                });

                // Safe: type and payload were validated on initial publish
                await sendToQueue({
                    jobId: job.id,
                    type: job.type as JobType,
                    payload: job.payload as SqsMessageBody['payload'],
                });

                return updated;
            }),
    }),
});
