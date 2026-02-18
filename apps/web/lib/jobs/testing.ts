/**
 * Testing utilities for mocking job publishing operations
 *
 * @example
 * ```typescript
 * import { vi } from 'vitest';
 * import { createJobsMock, mockJobs } from '@/lib/jobs/testing';
 *
 * vi.mock('@/lib/jobs', () => ({
 *   jobs: mockJobs,
 * }));
 * ```
 */

import type { Job, JobInput } from '@nexus/db/repo/jobs';
import { createJobFixture } from '@nexus/db/testing';

const publishMock = async (_db: unknown, input: JobInput): Promise<Job> => {
    return createJobFixture({
        type: input.type,
        payload: input.payload,
    });
};

interface MockJobs {
    publish: typeof publishMock;
}

/**
 * Creates mock implementations for the jobs module
 *
 * Returns an object matching the structure of `@/lib/jobs`'s `jobs` export.
 *
 * @example
 * ```typescript
 * vi.mock('@/lib/jobs', () => ({
 *   jobs: createJobsMock(),
 * }));
 * ```
 */
export function createJobsMock(): MockJobs {
    return {
        publish: publishMock,
    };
}

/**
 * Pre-built mock jobs object for simple mock setups
 *
 * @example
 * ```typescript
 * vi.mock('@/lib/jobs', () => ({
 *   jobs: mockJobs,
 * }));
 * ```
 */
export const mockJobs: MockJobs = createJobsMock();
