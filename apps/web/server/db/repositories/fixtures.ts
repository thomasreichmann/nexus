import * as schema from '../schema';
import type { File, NewFile } from './files';

export const TEST_USER_ID = 'user_test123';
export const TEST_FILE_ID = 'file_test456';
export const TEST_STORAGE_USAGE_ID = 'storage_test789';

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
