import { publish } from './publish';

/**
 * Background job operations
 *
 * @example
 * ```typescript
 * import { jobs } from '@/lib/jobs';
 *
 * const job = await jobs.publish(db, {
 *   type: 'delete-account',
 *   payload: { userId: 'user123' },
 * });
 * ```
 */
export const jobs = { publish } as const;

// Re-export types for convenience
export type {
    JobType,
    JobInput,
    JobPayloadMap,
    SqsMessageBody,
} from '@nexus/db/repo/jobs';
