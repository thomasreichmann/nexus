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

/** A curated retrieval to seed against an already-inserted file, by name. */
export interface RetrievalSpec {
    file: string;
    status: 'ready' | 'in_progress' | 'pending';
    init: Date;
}

/**
 * Inserts curated retrievals against files already seeded by name, mapping
 * `ready` to a plausible readyAt (+5h) and download window (now +6d).
 * Shared by the curated seeds (tooling/capture's demo library, the
 * adversarial library); specs missing from `fileIdByName` are skipped.
 */
export async function insertRetrievalSpecs(
    db: DB,
    userId: string,
    fileIdByName: Record<string, string>,
    specs: RetrievalSpec[]
): Promise<void> {
    for (const r of specs) {
        const fileId = fileIdByName[r.file];
        if (!fileId) continue;
        await insertRetrieval(db, {
            userId,
            fileId,
            status: r.status,
            tier: 'standard',
            initiatedAt: r.init,
            readyAt:
                r.status === 'ready'
                    ? new Date(r.init.getTime() + 5 * 3_600_000)
                    : null,
            expiresAt:
                r.status === 'ready'
                    ? new Date(Date.now() + 6 * 86_400_000)
                    : null,
        });
    }
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
