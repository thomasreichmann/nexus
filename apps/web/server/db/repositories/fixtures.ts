import type { File, NewFile } from './files';

export const TEST_USER_ID = 'user_test123';
export const TEST_FILE_ID = 'file_test456';

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
