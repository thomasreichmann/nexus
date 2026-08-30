/**
 * The worker's binding of `@nexus/email` — counterpart to the app's
 * `server/services/email.ts`, and the sibling of `analytics.ts`.
 *
 * The Lambda is where the message that matters gets sent: a restore completes
 * 12-48 hours after anyone asked for it, with no session and no browser
 * attached, and the only process that knows it happened is this one. The app's
 * `emailService` can't be reused — it reaches for `@/lib/alerts` and
 * `@/server/lib/logger`, neither of which exists outside Next — so the send
 * contract is re-expressed here against the same package.
 *
 * `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are absent from `WorkerEnvVar` on
 * purpose: `@nexus/email` reads and validates them itself, in both runtimes
 * (see `aws.ts`).
 */
import { createElement } from 'react';
import { createUserRepo } from '@nexus/db/repo/users';
import { email } from '@nexus/email';

import { requireEnv } from './aws';

import type { DB } from '@nexus/db';

export interface RetrievalRequestReadyOptions {
    userId: string;
    requestId: string;
    fileCount: number;
    partCount: number;
    totalBytes: number;
    expiresAt: Date;
}

/**
 * Where the ready-email points.
 *
 * An app link, never a presigned S3 URL: the click can land days after the
 * send, while a presigned GET lives an hour, and the app re-checks ownership
 * and mints a fresh one on arrival. `?request=` rides the existing deep-link
 * machinery — `proxy.ts` preserves path+query through the sign-in redirect, so
 * a signed-out reader arrives at the right place after authenticating.
 *
 * Exported so the test asserts the same string the app's route parses; the two
 * halves live in different packages and nothing else keeps them honest.
 */
export function retrievalRequestUrl(appUrl: string, requestId: string): string {
    return `${appUrl.replace(/\/$/, '')}/dashboard/files?request=${requestId}`;
}

/**
 * Announce a completed multi-file restore. At most once per request — the
 * caller is the single winner of the `completed_at` election.
 *
 * Warn-and-swallow, both for an unknown user and for a failed send: the
 * request is already complete and the artifacts are already downloadable, so a
 * Resend outage must not fail (and thereby retry) the build job that finished
 * successfully. The accepted cost is that a request can go unannounced, which
 * is the contract `apps/web/server/services/email.ts` has always stated.
 *
 * `console` rather than a logger for the reason `@nexus/analytics` gives: the
 * app's pino sits behind its validated env module and the worker has nothing at
 * all, while both runtimes collect stdout the same way.
 */
export async function sendRetrievalRequestReadyEmail(
    db: DB,
    opts: RetrievalRequestReadyOptions
): Promise<void> {
    const user = await createUserRepo(db).findById(opts.userId);
    if (!user) {
        console.warn(
            `retrieval-ready email: skipping request ${opts.requestId} — unknown user ${opts.userId}`
        );
        return;
    }

    const props = {
        downloadUrl: retrievalRequestUrl(requireEnv('APP_URL'), opts.requestId),
        fileCount: opts.fileCount,
        partCount: opts.partCount,
        totalBytes: opts.totalBytes,
        expiresAt: opts.expiresAt,
    };

    try {
        await email.send({
            to: user.email,
            subject: email.templates.retrievalRequestReadySubject(props),
            react: createElement(
                email.templates.RetrievalRequestReadyEmail,
                props
            ),
        });
    } catch (err) {
        console.warn(
            `retrieval-ready email: send failed for request ${opts.requestId}`,
            err
        );
    }
}
