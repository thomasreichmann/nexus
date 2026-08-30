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

export interface RetrievalFileReadyOptions {
    userId: string;
    /** For the warn lines only — the email deep-links to the file, not the request. */
    requestId: string;
    fileId: string;
    fileName: string;
    /** Null on pre-#424 or hand-seeded rows; the email is skipped rather than sent with a made-up expiry. */
    expiresAt: Date | null;
}

/**
 * Where a single-file ready email points: the file browser, scrolled to and
 * highlighting the restored file (`?file=` is the deep link the files page
 * parses, the sibling of `?request=` below). An app link for the same reason
 * as `retrievalRequestUrl` — the click can land days after the send, so the
 * app re-checks ownership and mints the presigned GET on arrival.
 */
export function retrievalFileUrl(appUrl: string, fileId: string): string {
    return `${appUrl.replace(/\/$/, '')}/dashboard/files?file=${fileId}`;
}

/**
 * Announce a completed single-file restore (#437). At most once per request —
 * the caller is the single winner of the `completed_at` election — with the
 * same warn-and-swallow contract as `sendRetrievalRequestReadyEmail` below:
 * the file is downloadable whether or not Resend answers, so a failed send
 * costs the announcement, never the completed request.
 *
 * A null expiry is skipped, not defaulted: it only occurs on rows no real
 * request path writes, and this email's one time-sensitive claim is the
 * expiry date — inventing one would be worse than staying quiet.
 */
export async function sendRetrievalFileReadyEmail(
    db: DB,
    opts: RetrievalFileReadyOptions
): Promise<void> {
    if (!opts.expiresAt) {
        console.warn(
            `retrieval-ready email (single-file): skipping request ${opts.requestId} — retrieval has no expiry to announce`
        );
        return;
    }

    const user = await createUserRepo(db).findById(opts.userId);
    if (!user) {
        console.warn(
            `retrieval-ready email (single-file): skipping request ${opts.requestId} — unknown user ${opts.userId}`
        );
        return;
    }

    const props = {
        fileName: opts.fileName,
        downloadUrl: retrievalFileUrl(requireEnv('APP_URL'), opts.fileId),
        expiresAt: opts.expiresAt,
    };

    try {
        await email.send({
            to: user.email,
            subject: email.templates.retrievalReadySubject(props),
            react: createElement(email.templates.RetrievalReadyEmail, props),
        });
    } catch (err) {
        console.warn(
            `retrieval-ready email (single-file): send failed for request ${opts.requestId}`,
            err
        );
    }
}

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
