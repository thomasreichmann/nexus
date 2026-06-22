import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import type { Connection } from '@nexus/db/test-db';
import {
    findUserByEmail,
    updateUserRole,
    ensureTrialSubscription,
    deleteUserData,
} from '@nexus/db/test-db';

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
 * Create a user via the BetterAuth sign-up API (which also writes the `account`
 * row with the hashed password, so the user can sign in). Idempotent: skips if
 * the user already exists. This is the back door for users that authenticate
 * through the UI — `insertUser` from `@nexus/db/test-db` only writes the bare
 * `user` row and can't produce a sign-in-able account.
 */
export async function createUser(
    request: APIRequestContext,
    db: Connection,
    testUser: TestUser
): Promise<void> {
    const existing = await findUserByEmail(db, testUser.email);
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
 * Promote a user to admin role.
 */
export async function promoteToAdmin(
    db: Connection,
    email: string
): Promise<void> {
    await updateUserRole(db, email, 'admin');
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

/**
 * Provisions a dedicated user end-to-end: creates it (idempotent), gives it a
 * fresh trial subscription, clears any leftover domain data from a prior run,
 * and saves its signed-in storageState. Returns the user id.
 *
 * Used by the worker-scoped `dedicatedUser` fixture (see
 * `fixtures/dedicated-user.ts`); kept as a plain function so the fixture stays
 * thin and so it can be reused outside the fixture chain if needed.
 */
export async function provisionDedicatedUser(
    db: Connection,
    testUser: TestUser,
    storageStatePath: string
): Promise<{ userId: string }> {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    try {
        await createUser(ctx, db, testUser);
        const user = await findUserByEmail(db, testUser.email);
        if (!user) {
            throw new Error(`${testUser.email} missing after createUser`);
        }
        await ensureTrialSubscription(db, user.id);
        await deleteUserData(db, user.id);
        await authenticateAndSaveState(ctx, testUser, storageStatePath);
        return { userId: user.id };
    } finally {
        await ctx.dispose();
    }
}
