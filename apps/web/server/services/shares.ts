import { createHmac, randomBytes } from 'node:crypto';
import { createShareRepo, type ShareWithFiles } from '@nexus/db/repo/shares';
import { env } from '@/lib/env';
import {
    MAX_DOWNLOADS_PER_SHARED_FILE,
    SHARE_RATE_WINDOW_MS,
    SHARE_TTL_MS,
    SHARE_UPLOAD_URL_TTL_SECONDS,
} from '@/lib/share/limits';
import {
    budgetProblemMessage,
    checkSelection,
    checkShareBudget,
    downloadUrlTtlSeconds,
    selectionProblemMessage,
    totalSize,
} from '@/lib/share/policy';
import { s3 } from '@/lib/storage';
import {
    InvalidStateError,
    NotFoundError,
    RateLimitedError,
} from '@/server/errors';
import { logger } from '@/server/lib/logger';
import type { DB } from '@nexus/db';

const log = logger.child({ service: 'shares' });

export interface ShareFileInput {
    name: string;
    size: number;
}

export interface CreateShareInput {
    files: ShareFileInput[];
    /** Undefined when no proxy reported one; those callers share one budget. */
    clientIp: string | undefined;
}

/** What anyone holding the link may know about it. */
export interface PublicShare {
    id: string;
    expiresAt: Date;
    totalSize: number;
    files: { id: string; name: string; size: number }[];
}

// a-z and 2-9 without the look-alikes l and o: 32 symbols, so each random byte
// maps to one with no modulo bias, and a link survives being read aloud.
const SHARE_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
// 14 symbols x 5 bits = 70 bits. The id is the credential, but one that
// expires in a day and guards nothing beyond its own files.
const SHARE_ID_LENGTH = 14;

function generateShareId(): string {
    return Array.from(
        randomBytes(SHARE_ID_LENGTH),
        (byte) => SHARE_ID_ALPHABET[byte % SHARE_ID_ALPHABET.length]
    ).join('');
}

/**
 * The rate-limit key for an uploader. Keyed with the auth secret so the table
 * holds nothing that can be reversed into an address by hashing every IPv4.
 */
function hashClientIp(clientIp: string | undefined): string {
    return createHmac('sha256', env.BETTER_AUTH_SECRET)
        .update(`share-ip:${clientIp ?? 'unknown'}`)
        .digest('hex');
}

/**
 * Mint a link and one upload URL per file. The link stays dark until
 * `completeShare`; its 24 hours count from here, not from completion, because
 * the bucket deletes each object a day after its upload began and a link must
 * never outlive its files.
 */
async function createShare(
    db: DB,
    input: CreateShareInput,
    now: Date = new Date()
) {
    if (!s3.shares.isConfigured()) {
        throw new InvalidStateError('File sharing isn’t available right now');
    }
    const selectionProblem = checkSelection(input.files);
    if (selectionProblem) {
        throw new InvalidStateError(selectionProblemMessage(selectionProblem));
    }

    const id = generateShareId();
    const ipHash = hashClientIp(input.clientIp);
    const requestedBytes = totalSize(input.files);
    const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);
    const files = input.files.map((file, position) => {
        const fileId = crypto.randomUUID();
        return {
            id: fileId,
            shareId: id,
            name: file.name,
            size: file.size,
            s3Key: `${id}/${fileId}`,
            position,
        };
    });

    await db.transaction(async (tx) => {
        const repo = createShareRepo(tx);
        // Without the lock, parallel requests from one uploader would all read
        // the same usage and all pass.
        if (!(await repo.tryLockUploader(ipHash))) {
            throw new RateLimitedError(
                'Another upload from your network is just starting. Try again in a moment'
            );
        }
        const usage = await repo.usageSince(
            ipHash,
            new Date(now.getTime() - SHARE_RATE_WINDOW_MS)
        );
        const budgetProblem = checkShareBudget(usage, requestedBytes);
        if (budgetProblem) {
            log.warn(
                { budgetProblem, usage, requestedBytes },
                'Share creation refused by a limit'
            );
            throw new RateLimitedError(budgetProblemMessage(budgetProblem));
        }
        await repo.insert(
            {
                id,
                ipHash,
                totalSize: requestedBytes,
                expiresAt,
                createdAt: now,
            },
            files
        );
    });

    const uploads = await Promise.all(
        files.map(async (file) => ({
            fileId: file.id,
            url: await s3.shares.put(file.s3Key, {
                contentLength: file.size,
                expiresIn: SHARE_UPLOAD_URL_TTL_SECONDS,
            }),
        }))
    );

    log.info(
        { shareId: id, fileCount: files.length, totalSize: requestedBytes },
        'Share created'
    );

    // `uploads` is in the order of `input.files`.
    return { id, expiresAt, uploads };
}

/**
 * Turn the link on once its uploader has sent every file. Calling it again is
 * a no-op that reports the same link.
 *
 * The objects aren't checked against S3, like `confirmUpload` for a user's own
 * files: the upload URLs sign each file's exact length, so nothing larger than
 * declared can be stored, and an uploader who completes without uploading
 * only breaks their own link.
 */
async function completeShare(db: DB, id: string, now: Date = new Date()) {
    const repo = createShareRepo(db);
    const share =
        (await repo.markReady(id, now)) ?? (await repo.findActive(id, now));
    if (!share) throw new NotFoundError('Share');
    return { id: share.id, expiresAt: share.expiresAt };
}

/** The link's contents, or `undefined` when it isn't live: unknown, still uploading, or expired. */
async function getShare(
    db: DB,
    id: string,
    now: Date = new Date()
): Promise<PublicShare | undefined> {
    const share = await createShareRepo(db).findActive(id, now);
    return share && toPublicShare(share);
}

/**
 * Sign a download of one file, and count it. What is counted is URLs issued,
 * not bytes served: a URL can be fetched again until it expires, so the cap
 * bounds ordinary use and a link gone viral, not a script replaying one URL.
 */
async function getDownloadUrl(
    db: DB,
    input: { shareId: string; fileId: string },
    now: Date = new Date()
) {
    const repo = createShareRepo(db);
    const share = await repo.findActive(input.shareId, now);
    const file = share?.files.find(
        (candidate) => candidate.id === input.fileId
    );
    if (!share || !file) throw new NotFoundError('Share');

    const claimed = await repo.claimDownload(
        file.id,
        MAX_DOWNLOADS_PER_SHARED_FILE
    );
    if (!claimed) {
        log.warn(
            { shareId: share.id, fileId: file.id },
            'Shared file reached its download limit'
        );
        throw new RateLimitedError(
            'This file has reached its download limit. Ask whoever sent it to share it again'
        );
    }

    const url = await s3.shares.get(file.s3Key, {
        filename: file.name,
        expiresIn: downloadUrlTtlSeconds(share.expiresAt, now),
    });
    return { url };
}

function toPublicShare(share: ShareWithFiles): PublicShare {
    return {
        id: share.id,
        expiresAt: share.expiresAt,
        totalSize: share.totalSize,
        files: share.files.map(({ id, name, size }) => ({ id, name, size })),
    };
}

export const shareService = {
    createShare,
    completeShare,
    getShare,
    getDownloadUrl,
} as const;
