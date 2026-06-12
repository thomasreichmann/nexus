import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { ensureTrialSubscription, findUserByEmail, updateUserRole } from './db';

const BASE_URL = 'http://localhost:3000';
const AUTH_HEADERS = { Origin: BASE_URL };

export interface TestUser {
    email: string;
    password: string;
    name: string;
}

export const ADMIN_USER: TestUser = {
    email: 'admin-e2e@test.local',
    password: 'admin-e2e-password-123',
    name: 'Admin E2E',
};

export const REGULAR_USER: TestUser = {
    email: 'user-e2e@test.local',
    password: 'user-e2e-password-123',
    name: 'User E2E',
};

export const ADMIN_STATE_PATH = 'e2e/.auth/admin.json';
export const USER_STATE_PATH = 'e2e/.auth/user.json';

/**
 * Create a user via BetterAuth sign-up API. Skips if user already exists.
 */
export async function createUser(
    request: APIRequestContext,
    testUser: TestUser
): Promise<void> {
    const existing = await findUserByEmail(testUser.email);
    if (existing) return;

    const response = await request.post('/api/auth/sign-up/email', {
        headers: AUTH_HEADERS,
        data: {
            name: testUser.name,
            email: testUser.email,
            password: testUser.password,
        },
    });

    if (!response.ok()) {
        throw new Error(
            `Sign-up failed for ${testUser.email}: ${response.status()} ${await response.text()}`
        );
    }
}

/**
 * Promote a user to admin role via direct DB update.
 */
export async function promoteToAdmin(email: string): Promise<void> {
    await updateUserRole(email, 'admin');
}

/**
 * Provisions a dedicated per-spec user: creates it (idempotent), gives it a
 * fresh trial subscription, and saves its signed-in storageState. Flows specs
 * call this in `beforeAll` and pair it with
 * `test.use({ storageState: <path> })` so each spec owns an isolated user —
 * empty-state and exact-count assertions can't race other specs.
 */
export async function provisionDedicatedUser(
    testUser: TestUser,
    storageStatePath: string
): Promise<{ userId: string }> {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    try {
        await createUser(ctx, testUser);
        const user = await findUserByEmail(testUser.email);
        if (!user) {
            throw new Error(`${testUser.email} missing after createUser`);
        }
        await ensureTrialSubscription(user.id);
        await authenticateAndSaveState(ctx, testUser, storageStatePath);
        return { userId: user.id };
    } finally {
        await ctx.dispose();
    }
}

/**
 * Sign in a user and save storageState to a file for reuse across tests.
 */
export async function authenticateAndSaveState(
    request: APIRequestContext,
    testUser: TestUser,
    storageStatePath: string
): Promise<void> {
    const response = await request.post('/api/auth/sign-in/email', {
        headers: AUTH_HEADERS,
        data: {
            email: testUser.email,
            password: testUser.password,
        },
    });

    if (!response.ok()) {
        throw new Error(
            `Sign-in failed for ${testUser.email}: ${response.status()} ${await response.text()}`
        );
    }

    await request.storageState({ path: storageStatePath });
}
