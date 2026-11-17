import { vi } from 'vitest';
import { it, describe, expect, afterEach } from '@nexus/db/test-db/integration';
import { deleteShares, insertShare, type DB } from '@nexus/db/test-db';

// The database is real: the per-uploader limit only means something if
// concurrent requests can't all read the same usage, and no mock can race.
// Only S3 is faked, and presigning never leaves the process anyway.
const s3Mocks = vi.hoisted(() => ({
    isConfigured: vi.fn(() => true),
    put: vi.fn(async (key: string) => `https://s3.test/put/${key}`),
    get: vi.fn(async (key: string) => `https://s3.test/get/${key}`),
}));

vi.mock('@/lib/storage', () => ({ s3: { shares: s3Mocks } }));

import { createShareRepo } from '@nexus/db/repo/shares';
import {
    MAX_DOWNLOADS_PER_SHARED_FILE,
    MAX_SHARE_BYTES,
    MAX_SHARE_BYTES_PER_IP,
    MAX_SHARES_PER_IP,
    SHARE_TTL_MS,
} from '@/lib/share/limits';
import {
    InvalidStateError,
    NotFoundError,
    RateLimitedError,
} from '@/server/errors';
import { shareService } from './shares';

const NOW = new Date('2026-11-17T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

// Shares belong to no user, so nothing cascades them away.
const createdIds: string[] = [];

/** A fresh uploader per test: its limits start empty whatever else ran. */
const newClientIp = () => `test-${crypto.randomUUID()}`;

async function createShare(
    db: DB,
    clientIp: string | undefined,
    files = [{ name: 'a.txt', size: 10 }],
    now = NOW
) {
    const share = await shareService.createShare(db, { files, clientIp }, now);
    createdIds.push(share.id);
    return share;
}

afterEach(async ({ db }) => {
    await deleteShares(db, createdIds.splice(0));
    vi.clearAllMocks();
});

describe('createShare', () => {
    it('stores the link dark, with its files, expiring 24 hours on', async ({
        db,
    }) => {
        const share = await createShare(db, newClientIp(), [
            { name: 'a.txt', size: 10 },
            { name: 'b.txt', size: 32 },
        ]);

        // Lowercase letters and digits, minus the look-alikes: what goes in
        // the link.
        expect(share.id).toMatch(/^[a-km-np-z2-9]{14}$/);
        const stored = await createShareRepo(db).findWithFiles(share.id);
        expect(stored).toMatchObject({
            status: 'uploading',
            totalSize: 42,
            expiresAt: new Date(NOW.getTime() + SHARE_TTL_MS),
        });
        expect(stored?.files.map(({ name, size }) => ({ name, size }))).toEqual(
            [
                { name: 'a.txt', size: 10 },
                { name: 'b.txt', size: 32 },
            ]
        );
    });

    it('returns one upload URL per file, in order, each signed for that file’s exact size', async ({
        db,
    }) => {
        const share = await createShare(db, newClientIp(), [
            { name: 'a.txt', size: 10 },
            { name: 'b.txt', size: 32 },
        ]);

        const stored = await createShareRepo(db).findWithFiles(share.id);
        expect(share.uploads).toEqual(
            stored!.files.map((file) => ({
                fileId: file.id,
                url: `https://s3.test/put/${share.id}/${file.id}`,
            }))
        );
        expect(
            s3Mocks.put.mock.calls.map(([, options]) => options)
        ).toMatchObject([{ contentLength: 10 }, { contentLength: 32 }]);
    });

    it('never stores the uploader’s address', async ({ db }) => {
        const clientIp = newClientIp();
        const share = await createShare(db, clientIp);

        const stored = await createShareRepo(db).findWithFiles(share.id);
        expect(stored!.ipHash).not.toContain(clientIp);
    });

    it('gives callers with no known address one budget between them', async ({
        db,
    }) => {
        const repo = createShareRepo(db);
        const anonymous = await createShare(db, undefined);
        const alsoAnonymous = await createShare(db, undefined);
        const named = await createShare(db, newClientIp());

        const hashOf = async (id: string) =>
            (await repo.findWithFiles(id))!.ipHash;
        expect(await hashOf(alsoAnonymous.id)).toBe(await hashOf(anonymous.id));
        expect(await hashOf(named.id)).not.toBe(await hashOf(anonymous.id));
    });

    it('refuses the link past an uploader’s daily count, without touching anyone else', async ({
        db,
    }) => {
        const clientIp = newClientIp();
        for (let i = 0; i < MAX_SHARES_PER_IP; i++) {
            await createShare(db, clientIp);
        }

        await expect(createShare(db, clientIp)).rejects.toBeInstanceOf(
            RateLimitedError
        );
        await expect(createShare(db, newClientIp())).resolves.toBeDefined();
    });

    it('refuses the link that would take an uploader past their daily bytes', async ({
        db,
    }) => {
        const clientIp = newClientIp();
        // The daily bytes are two full links, so it takes two to get close.
        await createShare(db, clientIp, [
            { name: 'full.bin', size: MAX_SHARE_BYTES },
        ]);
        await createShare(db, clientIp, [
            {
                name: 'nearly.bin',
                size: MAX_SHARE_BYTES_PER_IP - MAX_SHARE_BYTES - 10,
            },
        ]);

        await expect(
            createShare(db, clientIp, [{ name: 'over.bin', size: 11 }])
        ).rejects.toBeInstanceOf(RateLimitedError);
        await expect(
            createShare(db, clientIp, [{ name: 'fits.bin', size: 10 }])
        ).resolves.toBeDefined();
    });

    it('forgets an uploader’s shares once they are a day old', async ({
        db,
    }) => {
        const clientIp = newClientIp();
        const yesterday = new Date(NOW.getTime() - 24 * HOUR_MS);
        for (let i = 0; i < MAX_SHARES_PER_IP; i++) {
            await createShare(db, clientIp, undefined, yesterday);
        }

        await expect(createShare(db, clientIp)).resolves.toBeDefined();
    });

    // One link short of the limit, then a burst. Without the per-uploader
    // lock every request in the burst reads the same usage and passes.
    it('admits exactly the one link left when an uploader fires a burst at once', async ({
        db,
    }) => {
        const clientIp = newClientIp();
        for (let i = 0; i < MAX_SHARES_PER_IP - 1; i++) {
            await createShare(db, clientIp);
        }

        // The pool opens connections on demand, and opening one takes longer
        // than a whole creation. Unless six are already open, the burst runs
        // one after another and proves nothing.
        await Promise.all(
            Array.from({ length: 6 }, () => db.$client`select pg_sleep(0.05)`)
        );

        const results = await Promise.allSettled(
            Array.from({ length: 6 }, () => createShare(db, clientIp))
        );

        const refused = results.filter((r) => r.status === 'rejected');
        expect(results.length - refused.length).toBe(1);
        expect(refused.map((r) => r.reason)).toEqual(
            refused.map(() => expect.any(RateLimitedError))
        );
    });

    it('refuses a selection over the size cap before writing anything', async ({
        db,
    }) => {
        const clientIp = newClientIp();

        await expect(
            createShare(db, clientIp, [
                { name: 'huge.bin', size: MAX_SHARE_BYTES + 1 },
            ])
        ).rejects.toBeInstanceOf(InvalidStateError);
        // Nothing counted against the uploader: a full day's worth still fits.
        await expect(
            createShare(db, clientIp, [
                { name: 'max.bin', size: MAX_SHARE_BYTES },
            ])
        ).resolves.toBeDefined();
    });

    it('refuses to create a link when the shares bucket isn’t configured', async ({
        db,
    }) => {
        s3Mocks.isConfigured.mockReturnValueOnce(false);

        await expect(createShare(db, newClientIp())).rejects.toBeInstanceOf(
            InvalidStateError
        );
    });
});

describe('completeShare', () => {
    it('turns the link on, so its files become visible', async ({ db }) => {
        const share = await createShare(db, newClientIp());
        expect(await shareService.getShare(db, share.id, NOW)).toBeUndefined();

        await shareService.completeShare(db, share.id, NOW);

        expect(await shareService.getShare(db, share.id, NOW)).toMatchObject({
            id: share.id,
            totalSize: 10,
            files: [{ name: 'a.txt', size: 10 }],
        });
    });

    it('reports the same link when called a second time', async ({ db }) => {
        const share = await createShare(db, newClientIp());
        const first = await shareService.completeShare(db, share.id, NOW);

        expect(await shareService.completeShare(db, share.id, NOW)).toEqual(
            first
        );
    });

    it('refuses a link whose 24 hours ran out during the upload', async ({
        db,
    }) => {
        const share = await createShare(db, newClientIp());

        await expect(
            shareService.completeShare(db, share.id, share.expiresAt)
        ).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('getDownloadUrl', () => {
    async function seedLiveShare(db: DB, expiresAt: Date, downloadCount = 0) {
        const share = await insertShare(db, { status: 'ready', expiresAt }, [
            { name: 'report "final".pdf', downloadCount },
        ]);
        createdIds.push(share.id);
        return { shareId: share.id, file: share.files[0]! };
    }

    it('signs a download of the file under its own name', async ({ db }) => {
        const { shareId, file } = await seedLiveShare(
            db,
            new Date(NOW.getTime() + 5 * HOUR_MS)
        );

        const { url } = await shareService.getDownloadUrl(
            db,
            { shareId, fileId: file.id },
            NOW
        );

        expect(url).toBe(`https://s3.test/get/${file.s3Key}`);
        expect(s3Mocks.get).toHaveBeenCalledWith(file.s3Key, {
            filename: 'report "final".pdf',
            expiresIn: 3600,
        });
    });

    it('never signs a URL that outlives the link', async ({ db }) => {
        const { shareId, file } = await seedLiveShare(
            db,
            new Date(NOW.getTime() + 90_000)
        );

        await shareService.getDownloadUrl(
            db,
            { shareId, fileId: file.id },
            NOW
        );

        expect(s3Mocks.get.mock.calls[0]![1]).toMatchObject({ expiresIn: 90 });
    });

    it('counts each download against the file', async ({ db }) => {
        const { shareId, file } = await seedLiveShare(
            db,
            new Date(NOW.getTime() + HOUR_MS)
        );
        const input = { shareId, fileId: file.id };

        await shareService.getDownloadUrl(db, input, NOW);
        await shareService.getDownloadUrl(db, input, NOW);

        const stored = await createShareRepo(db).findWithFiles(shareId);
        expect(stored!.files[0]!.downloadCount).toBe(2);
    });

    it('signs the last download the limit allows, and none after it', async ({
        db,
    }) => {
        const { shareId, file } = await seedLiveShare(
            db,
            new Date(NOW.getTime() + HOUR_MS),
            MAX_DOWNLOADS_PER_SHARED_FILE - 1
        );
        const input = { shareId, fileId: file.id };

        await expect(
            shareService.getDownloadUrl(db, input, NOW)
        ).resolves.toMatchObject({ url: expect.any(String) });
        await expect(
            shareService.getDownloadUrl(db, input, NOW)
        ).rejects.toBeInstanceOf(RateLimitedError);
        expect(s3Mocks.get).toHaveBeenCalledTimes(1);
    });

    it('refuses once the link has expired', async ({ db }) => {
        const { shareId, file } = await seedLiveShare(db, NOW);

        await expect(
            shareService.getDownloadUrl(db, { shareId, fileId: file.id }, NOW)
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(s3Mocks.get).not.toHaveBeenCalled();
    });

    it('refuses a file that belongs to a different link', async ({ db }) => {
        const mine = await seedLiveShare(db, new Date(NOW.getTime() + HOUR_MS));
        const theirs = await seedLiveShare(
            db,
            new Date(NOW.getTime() + HOUR_MS)
        );

        await expect(
            shareService.getDownloadUrl(
                db,
                { shareId: mine.shareId, fileId: theirs.file.id },
                NOW
            )
        ).rejects.toBeInstanceOf(NotFoundError);
    });
});
