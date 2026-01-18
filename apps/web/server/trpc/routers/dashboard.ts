import { TRPCError } from '@trpc/server';
import { publicProcedure, router } from '../init';

const recentUploads = [
    {
        name: 'vacation-photos-2024.zip',
        size: '4.2 GB',
        date: '2 hours ago',
        status: 'archived' as const,
    },
    {
        name: 'project-backup.tar.gz',
        size: '12.8 GB',
        date: '1 day ago',
        status: 'archived' as const,
    },
    {
        name: 'raw-footage-jan.mov',
        size: '28.5 GB',
        date: '2 days ago',
        status: 'archived' as const,
    },
    {
        name: 'client-deliverables.zip',
        size: '1.3 GB',
        date: '3 days ago',
        status: 'archived' as const,
    },
    {
        name: 'music-library-backup.zip',
        size: '8.7 GB',
        date: '5 days ago',
        status: 'archived' as const,
    },
];

const retrievals = [
    {
        name: 'design-assets-2023.zip',
        size: '2.1 GB',
        requestedAt: '3 hours ago',
        readyIn: '~2 hours',
    },
    {
        name: 'old-projects.tar.gz',
        size: '5.4 GB',
        requestedAt: '6 hours ago',
        readyIn: '~5 hours',
    },
];

export const dashboardRouter = router({
    getRecentUploads: publicProcedure.query(({ ctx }) => {
        // Example of using the timing API
        ctx.log.setField('uploadCount', recentUploads.length);
        return recentUploads;
    }),

    getRetrievals: publicProcedure.query(({ ctx }) => {
        ctx.log.setField('retrievalCount', retrievals.length);
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Test logging: forced error in getRetrievals',
        });
        return retrievals;
    }),

    getStats: publicProcedure.query(({ ctx }) => {
        ctx.log.setField('source', 'mock');
        return {
            storageUsedGb: 34.2,
            storageTotalGb: 100,
            filesStored: 127,
            activeRetrievals: retrievals.length,
        };
    }),
});
