'use client';

import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from './server';

export const authClient = createAuthClient({
    plugins: [inferAdditionalFields<typeof auth>()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
