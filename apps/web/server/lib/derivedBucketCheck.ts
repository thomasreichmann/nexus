import { createFileRepo, thumbnailKey } from '@nexus/db/repo/files';
import { alerts } from '@/lib/alerts';
import { env } from '@/lib/env';
import { s3 } from '@/lib/storage';
import { db } from '@/server/db';
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
 * HeadObject is normally well under a second. Past this the check carries on
 * in the background rather than holding up the instance.
 */
const BOOT_CHECK_TIMEOUT_MS = 5000;

/**
 * Entry point for `instrumentation.ts`. Awaited there, not fire-and-forget:
 * Vercel may freeze an instance between requests, and an alert left pending
 * across that freeze may never send. Never throws: a check that can't run
 * (DB down, env invalid) is logged, and must not take the app down with it.
 */
export async function runDerivedBucketCheck(): Promise<void> {
    const check = checkDerivedBucket(db).catch((err: unknown) => {
        log.error({ err }, 'Derived bucket check could not run');
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), BOOT_CHECK_TIMEOUT_MS);
    });

    const outcome = await Promise.race([check, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
        log.warn(
            `Derived bucket check still running after ${BOOT_CHECK_TIMEOUT_MS}ms; continuing boot`
        );
    }
}
