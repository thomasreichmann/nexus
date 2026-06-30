import { request as pwRequest } from '@playwright/test';

import {
    deleteUserData,
    ensureTrialSubscription,
    findUserByEmail,
} from '@nexus/db/test-db';

import type { Db } from './db';
import type { CaptureUser } from './scene';

/** The dedicated, throwaway account recordings are driven as. Off-prod only. */
export const CAPTURE_USER = {
    email: 'capture-demo@nexus.local',
    password: 'capture-demo-password-123',
    name: 'Capture Demo',
} as const;

/**
 * Provision the capture user and save a Playwright storageState for the
 * recording context. Mirrors apps/web/e2e/helpers/auth.ts `provisionDedicatedUser`
 * — sign up (idempotent) through BetterAuth, ensure a trial sub so the dashboard
 * renders a plan, clear any prior library for a clean slate, then sign in and
 * snapshot the session. Kept self-contained so this package doesn't import from
 * the web app's e2e helpers. Only works off-production (the dev DB + open sign-up).
 */
export async function provisionCaptureUser(
    baseUrl: string,
    db: Db,
    statePath: string
): Promise<CaptureUser> {
    const ctx = await pwRequest.newContext({ baseURL: baseUrl });
    // BetterAuth checks the Origin against trusted origins; match the server.
    const headers = { Origin: baseUrl };
    try {
        if (!(await findUserByEmail(db, CAPTURE_USER.email))) {
            const res = await ctx.post('/api/auth/sign-up/email', {
                headers,
                data: {
                    name: CAPTURE_USER.name,
                    email: CAPTURE_USER.email,
                    password: CAPTURE_USER.password,
                },
            });
            if (!res.ok())
                throw new Error(
                    `Sign-up failed (${res.status()} ${res.statusText()}). Is this a dev server with open sign-up?`
                );
        }

        const user = await findUserByEmail(db, CAPTURE_USER.email);
        if (!user)
            throw new Error(`${CAPTURE_USER.email} missing after sign-up.`);

        await ensureTrialSubscription(db, user.id);
        await deleteUserData(db, user.id);

        const signIn = await ctx.post('/api/auth/sign-in/email', {
            headers,
            data: {
                email: CAPTURE_USER.email,
                password: CAPTURE_USER.password,
            },
        });
        if (!signIn.ok())
            throw new Error(
                `Sign-in failed (${signIn.status()} ${signIn.statusText()}).`
            );

        await ctx.storageState({ path: statePath });
        return { id: user.id, email: user.email };
    } finally {
        await ctx.dispose();
    }
}
