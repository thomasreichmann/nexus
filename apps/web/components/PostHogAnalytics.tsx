'use client';

import { useEffect } from 'react';

import { useSession } from '@/lib/auth/client';
import { identifyUser, initAnalytics } from '@/lib/posthog/client';

/**
 * Boots PostHog and keeps the identified person in sync with the session.
 * Renders nothing — posthog-js is a singleton, so nothing downstream needs
 * React context; this mirrors ClientErrorReporter rather than wrapping the
 * tree in a provider that would carry no value.
 *
 * `reset()` deliberately isn't here. useSession reports no user while the
 * session is still loading, which is indistinguishable at this level from a
 * sign-out, so an effect that reset on "user went away" would wipe the
 * distinct id on every cold load. Sign-out calls resetAnalytics() directly
 * (components/dashboard/header.tsx), where the intent is unambiguous.
 */
export function PostHogAnalytics(): null {
    const { data: session } = useSession();
    const userId = session?.user?.id;

    useEffect(() => {
        initAnalytics();
    }, []);

    useEffect(() => {
        if (userId) identifyUser(userId);
    }, [userId]);

    return null;
}
