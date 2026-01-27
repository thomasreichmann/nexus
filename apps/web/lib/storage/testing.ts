/**
 * Testing utilities for mocking S3 storage operations
 *
 * These utilities provide deterministic mocks for `@/lib/storage` functions,
 * allowing unit tests to run without AWS credentials.
 *
 * @example
 * ```typescript
 * import { vi, describe, it, beforeEach } from 'vitest';
 * import { createPresignedMocks } from '@/lib/storage/testing';
 *
 * // Mock the storage module
 * vi.mock('@/lib/storage', () => ({
 *   s3: createPresignedMocks(),
 * }));
 *
 * describe('file upload', () => {
 *   it('generates upload URL', async () => {
 *     const { s3 } = await import('@/lib/storage');
 *     const url = await s3.presigned.put('user123/file456');
 *     expect(url).toBe('https://mock-s3.test/test-bucket/user123/file456');
 *   });
 * });
 * ```
 */

const MOCK_BUCKET = 'test-bucket';
const MOCK_HOST = 'https://mock-s3.test';

function createMockUrl(key: string): string {
    return `${MOCK_HOST}/${MOCK_BUCKET}/${key}`;
}

const presignedMocks = {
    put: async (key: string): Promise<string> => createMockUrl(key),
    get: async (key: string): Promise<string> => createMockUrl(key),
};

const glacierMocks = {
    restore: async (): Promise<void> => {},
    checkStatus: async (): Promise<{
        status: 'available' | 'restoring' | 'archived';
    }> => ({ status: 'available' }),
};

const objectsMocks = {
    remove: async (): Promise<void> => {},
};

interface MockS3 {
    presigned: typeof presignedMocks;
    glacier: typeof glacierMocks;
    objects: typeof objectsMocks;
}

/**
 * Creates mock implementations for the s3 storage module
 *
 * Returns an object matching the structure of `@/lib/storage`'s `s3` export.
 * All mocks are deterministic: the same key always produces the same URL.
 *
 * @example
 * ```typescript
 * // In your test file:
 * import { vi } from 'vitest';
 * import { createPresignedMocks } from '@/lib/storage/testing';
 *
 * vi.mock('@/lib/storage', () => ({
 *   s3: createPresignedMocks(),
 * }));
 *
 * // Now s3.presigned.put('key') returns 'https://mock-s3.test/test-bucket/key'
 * // And s3.presigned.get('key') returns 'https://mock-s3.test/test-bucket/key'
 * ```
 */
export function createPresignedMocks(): MockS3 {
    return {
        presigned: presignedMocks,
        glacier: glacierMocks,
        objects: objectsMocks,
    };
}

/**
 * Pre-built mock s3 object for simple mock setups
 *
 * @example
 * ```typescript
 * vi.mock('@/lib/storage', () => ({
 *   s3: mockS3,
 * }));
 * ```
 */
export const mockS3: MockS3 = createPresignedMocks();
