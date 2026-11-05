import { createDb } from '@nexus/db';
import { createFileRepo, thumbnailKey } from '@nexus/db/repo/files';
import { alerts } from '@/lib/alerts';
import { env } from '@/lib/env';
import { s3 } from '@/lib/storage';
import { logger } from '@/server/lib/logger';
import type { DB } from '@nexus/db';

const log = logger.child({ service: 'derived-bucket-check' });

/**
 * Prove at boot that the app can read the thumbnails bucket (#409).
 *
 * Nothing else would notice. `getThumbnailUrls` presigns locally, so a wrong
 * bucket name, bad credentials or a revoked grant still hands out URLs, and
 * each one 404s or 403s in the browser, where the grid shows its icon
 * fallback. That looks exactly like "not generated yet", across the whole
 * library, with no error anywhere.
 *
 * The probe reads back a thumbnail the worker reports as written, not a made-up
 * key, because the app's GetObject-only grant answers 403 for a missing key
 * and a denied one alike. With no ready thumbnail anywhere there's nothing the
 * grid could show yet, so the check skips.
 *
 * An unset bucket only warns: the env var is optional by design (rollout
 * ordering, see lib/env/schema.ts), and the nightly env-parity check already
 * flags a key missing from one tier.
 */
export async function checkDerivedBucket(database: DB): Promise<void> {
    if (!s3.derived.isConfigured()) {
        log.warn(
            'S3_DERIVED_BUCKET is unset: every thumbnail falls back to an icon'
        );
        return;
    }

    const file = await createFileRepo(database).findLatestReadyThumbnail();
    if (!file) {
        log.info('No ready thumbnail to probe; skipping derived bucket check');
        return;
    }

    const key = thumbnailKey(file);
    try {
        await s3.derived.probe(key);
    } catch (err) {
        // Name first, unlike toErrorMessage: a HEAD response has no body, so
        // the SDK's message is often just "UnknownError" and the name
        // ("Forbidden", "NotFound") is what says what happened.
        const errorSummary =
            err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        log.error(
            { err, key },
            'Derived bucket unreachable: thumbnails will not load'
        );
        await alerts.send({
            severity: 'error',
            title: 'Thumbnail bucket unreachable',
            message:
                "The app can't read a thumbnail the worker reports as written, so every library renders as icon tiles. Fires once per cold start until fixed.",
            context: {
                source: 'boot',
                bucket: env.S3_DERIVED_BUCKET ?? '(unset)',
                key,
                error: errorSummary,
            },
        });
    }
}

/**
 * How long a cold start will wait on the check: one DB read plus one
 * HeadObject is normally well under a second. Past this the check is
 * abandoned rather than holding up the instance.
 */
const BOOT_CHECK_TIMEOUT_MS = 5000;

/**
 * Entry point for `instrumentation.ts`. Awaited there, not fire-and-forget:
 * Vercel may freeze an instance between requests, and an alert left pending
 * across that freeze may never send. Never throws: a check that can't run
 * (DB down, env invalid) is logged, and must not take the app down with it.
 *
 * The check reads through its own one-connection client, closed before this
 * returns, never through the shared pool. A read abandoned at the timeout
 * would otherwise stay on the wire into the freeze: on 2026-10-20 one sat
 * half-sent behind the pooler, its backend holding a lock on `files` until
 * the next migration's `ALTER TABLE` queued behind it and stalled every read
 * of `files` (#554). postgres-js has no client-side query timeout and the
 * pooler ignores `statement_timeout`, so closing the socket is the only way
 * to end a read that is still in flight.
 */
export async function runDerivedBucketCheck(
    timeoutMs = BOOT_CHECK_TIMEOUT_MS
): Promise<void> {
    const database = createDb(env.DATABASE_URL, { max: 1 });
    let isAbandoned = false;
    const check = checkDerivedBucket(database).catch((err: unknown) => {
        // Closing the connection on a timeout rejects the read still in
        // flight. That's our doing and the warn below reports it, so only a
        // check that failed on its own logs an error.
        if (isAbandoned) return;
        log.error({ err }, 'Derived bucket check could not run');
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([check, timeout]);
    clearTimeout(timer);
    isAbandoned = outcome === 'timeout';
    // `timeout: 0` destroys the socket instead of waiting for a pending read
    // to finish.
    await database.$client.end({ timeout: 0 });
    if (isAbandoned) {
        log.warn(
            `Derived bucket check still running after ${timeoutMs}ms; closed its DB connection and continuing boot`
        );
    }
}
