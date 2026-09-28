/**
 * Shared by the upload flow specs (`e2e/flows/upload-*.spec.ts`). They are
 * split by what they exercise, each as its own dedicated user, so the groups
 * run on parallel workers instead of as one serial chain (#499).
 */
import type { TestUser } from './auth';

export const UPLOAD_PAGE_URL = '/dashboard/upload';

export const FILE_A = {
    name: 'queue-a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('queue file a\n'),
};
export const FILE_B = {
    name: 'queue-b.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('queue file b — slightly longer\n'),
};

/**
 * The `dedicatedUserConfig` for one upload spec: base names, which the fixture
 * scopes to the run and worker (#484). One slug per spec file, so no two files
 * ever share a user's data.
 */
export function uploadSpecUser(slug: string): {
    user: TestUser;
    statePath: string;
} {
    return {
        user: {
            email: `upload-${slug}-e2e@test.local`,
            password: `upload-${slug}-e2e-password-123`,
            name: `Upload ${slug} E2E`,
        },
        statePath: `e2e/.auth/upload-${slug}.json`,
    };
}
