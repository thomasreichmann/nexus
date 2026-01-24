import type { File, NewFile } from './files';

/** Default test user ID */
export const TEST_USER_ID = 'user_test123';

/** Default test file ID */
export const TEST_FILE_ID = 'file_test456';

/**
 * Create a complete File fixture for testing queries.
 */
export function createFileFixture(overrides: Partial<File> = {}): File {
    const now = new Date();
    return {
        id: TEST_FILE_ID,
        userId: TEST_USER_ID,
        name: 'test-document.pdf',
        size: 1024000, // 1MB
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

/**
 * Create insert data (NewFile) for testing mutations.
 */
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
