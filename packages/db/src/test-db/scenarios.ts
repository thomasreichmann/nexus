/**
 * Scenario helpers: multi-step states a single insert can't express. These
 * compose the insert/query helpers so column defaults still flow from the
 * shared factories.
 */
import type { DB } from '../connection';
import type { File } from '../repositories/files';
import type { Retrieval } from '../repositories/retrievals';
import { insertFile, insertRetrieval } from './inserts';
import { ensureTrialSubscription, markSubscriptionPaid } from './queries';
import type { PlanTier } from '../plans';

export interface ReadyRetrievalResult {
    file: File;
    retrieval: Retrieval;
}

/**
 * A glacier file plus a retrieval driven to `ready` — the only way to exercise
 * the download path without a multi-hour Glacier restore (`getDownloadUrl`
 * requires a ready retrieval). Override the file/retrieval via `opts`.
 */
export async function readyRetrieval(
    db: DB,
    opts: {
        userId: string;
        file?: Partial<File>;
        retrieval?: Partial<Retrieval>;
    }
): Promise<ReadyRetrievalResult> {
    const file = await insertFile(db, {
        userId: opts.userId,
        storageTier: 'glacier',
        status: 'available',
        ...opts.file,
    });
    const retrieval = await insertRetrieval(db, {
        userId: opts.userId,
        fileId: file.id,
        status: 'ready',
        ...opts.retrieval,
    });
    return { file, retrieval };
}

/**
 * Drives a user to an active paid subscription from scratch: ensures a trial
 * row exists, then promotes it. For dedicated-user specs that start with no
 * subscription; shared-user specs that flip-then-reset call `markSubscriptionPaid`
 * directly.
 */
export async function paidSubscription(
    db: DB,
    userId: string,
    options?: { tier?: PlanTier }
): Promise<void> {
    await ensureTrialSubscription(db, userId);
    await markSubscriptionPaid(db, userId, options);
}
