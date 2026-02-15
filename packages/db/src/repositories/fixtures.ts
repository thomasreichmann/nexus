import * as schema from '../schema';
import type { File, NewFile } from './files';
import type { Job, NewJob } from './jobs';
import type { Retrieval } from './retrievals';

export const TEST_USER_ID = 'user_test123';
export const TEST_FILE_ID = 'file_test456';
export const TEST_STORAGE_USAGE_ID = 'storage_test789';
export const TEST_JOB_ID = 'job_test101';
export const TEST_RETRIEVAL_ID = 'retrieval_test202';

export type User = typeof schema.user.$inferSelect;
export type StorageUsage = typeof schema.storageUsage.$inferSelect;

export function createFileFixture(overrides: Partial<File> = {}): File {
    const now = new Date();
    return {
        id: TEST_FILE_ID,
        userId: TEST_USER_ID,
        name: 'test-document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        s3Key: `${TEST_USER_ID}/${TEST_FILE_ID}`,
        storageTier: 'glacier',
        status: 'available',
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: null,
        deletedAt: null,
        ...overrides,
    };
}

export function createNewFileFixture(
    overrides: Partial<NewFile> = {}
): NewFile {
    return {
        id: TEST_FILE_ID,
        userId: TEST_USER_ID,
        name: 'test-document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        s3Key: `${TEST_USER_ID}/${TEST_FILE_ID}`,
        ...overrides,
    };
}

export function createUserFixture(overrides: Partial<User> = {}): User {
    const now = new Date();
    const id = overrides.id ?? crypto.randomUUID();
    return {
        id,
        name: 'Test User',
        email: `${id}@test.example`,
        emailVerified: false,
        image: null,
        role: 'user',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createStorageUsageFixture(
    overrides: Partial<StorageUsage> = {}
): StorageUsage {
    const now = new Date();
    return {
        id: overrides.id ?? crypto.randomUUID(),
        userId: overrides.userId ?? TEST_USER_ID,
        usedBytes: 0,
        fileCount: 0,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createJobFixture(overrides: Partial<Job> = {}): Job {
    const now = new Date();
    return {
        id: TEST_JOB_ID,
        type: 'delete-account',
        payload: { userId: TEST_USER_ID },
        status: 'pending',
        attempts: 0,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createNewJobFixture(overrides: Partial<NewJob> = {}): NewJob {
    return {
        type: 'delete-account',
        payload: { userId: TEST_USER_ID },
        ...overrides,
    };
}

export function createRetrievalFixture(
    overrides: Partial<Retrieval> = {}
): Retrieval {
    const now = new Date();
    return {
        id: TEST_RETRIEVAL_ID,
        fileId: TEST_FILE_ID,
        userId: TEST_USER_ID,
        status: 'pending',
        tier: 'standard',
        initiatedAt: null,
        readyAt: null,
        expiresAt: null,
        failedAt: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}
