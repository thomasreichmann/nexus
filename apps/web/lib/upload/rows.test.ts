import { afterEach, describe, expect, it } from 'vitest';
import {
    formatSessionBatchName,
    normalizeSubpath,
    patchRowById,
    patchRowsWhere,
    resolveSubpath,
    resolveUnanimousFolderName,
} from './rows';

interface Row {
    id: string;
    progress: number;
    status: string;
    error?: string;
}

const rows: Row[] = [
    { id: 'a', progress: 10, status: 'uploading' },
    { id: 'b', progress: 0, status: 'pending' },
];

describe('patchRowById', () => {
    it('returns the same array when the id is unknown', () => {
        expect(patchRowById(rows, 'missing', { progress: 50 })).toBe(rows);
    });

    it('returns the same array when no field actually changes', () => {
        expect(patchRowById(rows, 'a', { progress: 10 })).toBe(rows);
        expect(
            patchRowById(rows, 'a', { progress: 10, status: 'uploading' })
        ).toBe(rows);
        // An absent optional field patched to undefined is still a no-op.
        expect(patchRowById(rows, 'a', { error: undefined })).toBe(rows);
    });

    it('patches the matching row and keeps sibling references', () => {
        const next = patchRowById(rows, 'a', { progress: 11 });
        expect(next).not.toBe(rows);
        expect(next[0]).toEqual({ id: 'a', progress: 11, status: 'uploading' });
        expect(next[1]).toBe(rows[1]);
        // Input is untouched.
        expect(rows[0].progress).toBe(10);
    });

    it('treats clearing a set field as a change', () => {
        const failed: Row[] = [
            { id: 'a', progress: 40, status: 'error', error: 'boom' },
        ];
        const next = patchRowById(failed, 'a', { error: undefined });
        expect(next).not.toBe(failed);
        expect(next[0].error).toBeUndefined();
    });
});

describe('patchRowsWhere', () => {
    const isPending = (row: Row) => row.status === 'pending';

    it('returns the same array when nothing matches or nothing changes', () => {
        expect(patchRowsWhere(rows, () => false, { progress: 50 })).toBe(rows);
        expect(patchRowsWhere(rows, isPending, { progress: 0 })).toBe(rows);
    });

    it('patches every matching row in one pass and keeps the rest', () => {
        const queue: Row[] = [
            ...rows,
            { id: 'c', progress: 0, status: 'pending' },
        ];
        const next = patchRowsWhere(queue, isPending, { status: 'queued' });
        expect(next).not.toBe(queue);
        expect(next.map((row) => row.status)).toEqual([
            'uploading',
            'queued',
            'queued',
        ]);
        expect(next[0]).toBe(queue[0]);
        // Input is untouched.
        expect(queue[1].status).toBe('pending');
    });

    it('lets each matching row compute its own patch', () => {
        const next = patchRowsWhere(rows, isPending, (row) => ({
            error: `${row.id} failed`,
        }));
        expect(next[1].error).toBe('b failed');
        expect(next[0]).toBe(rows[0]);
    });
});

describe('resolveUnanimousFolderName', () => {
    const shoot = { gestureId: 1, name: 'shoot-2026-08-18' };

    it('names a wave that came entirely from one folder gesture', () => {
        expect(
            resolveUnanimousFolderName([
                { folderOrigin: shoot },
                { folderOrigin: shoot },
            ])
        ).toBe('shoot-2026-08-18');
    });

    it('declines a wave holding a file from no folder', () => {
        expect(
            resolveUnanimousFolderName([{ folderOrigin: shoot }, {}])
        ).toBeUndefined();
        expect(
            resolveUnanimousFolderName([{}, { folderOrigin: shoot }])
        ).toBeUndefined();
    });

    it('declines two folder gestures, even same-named ones', () => {
        expect(
            resolveUnanimousFolderName([
                { folderOrigin: shoot },
                { folderOrigin: { gestureId: 2, name: shoot.name } },
            ])
        ).toBeUndefined();
    });

    it('declines an empty wave', () => {
        expect(resolveUnanimousFolderName([])).toBeUndefined();
    });
});

// #405: what a file's folder is stored as, relative to the batch it joins.
describe('formatSessionBatchName', () => {
    const zone = process.env.TZ;
    afterEach(() => {
        process.env.TZ = zone;
    });

    // #408: the alpha cohort is in Brazil, and a UTC name put a 16:47 upload
    // at 19:47. Pinned to a zone other than UTC so a UTC name can't pass.
    it('names the moment in the uploader’s own time zone, to the second', () => {
        process.env.TZ = 'America/Sao_Paulo';

        expect(formatSessionBatchName(new Date('2026-08-18T19:47:05Z'))).toBe(
            'Upload 2026-08-18 16:47:05'
        );
    });
});

describe('resolveSubpath', () => {
    it('drops the folder’s own name when the batch is named after it', () => {
        expect(resolveSubpath('Shoot/104CANON', true)).toBe('104CANON');
        expect(resolveSubpath('Shoot/104CANON/RAW', true)).toBe('104CANON/RAW');
    });

    it('stores nothing for a file at the top of the batch’s folder', () => {
        expect(resolveSubpath('Shoot', true)).toBeUndefined();
    });

    // Two cards of one camera, each in a folder with a 104CANON inside: in
    // one unnamed batch, only the dropped folder's name tells them apart.
    it('keeps the whole path when the batch is about more than one folder', () => {
        expect(resolveSubpath('Loja 1/104CANON', false)).toBe(
            'Loja 1/104CANON'
        );
        expect(resolveSubpath('Loja 1', false)).toBe('Loja 1');
    });

    it('stores nothing for a file dropped loose', () => {
        expect(resolveSubpath(undefined, false)).toBeUndefined();
        expect(resolveSubpath(undefined, true)).toBeUndefined();
    });
});

// The library groups folder rows by equal subpaths, so one folder must have
// one spelling however the client sent it.
describe('normalizeSubpath', () => {
    it('spells a folder one way whatever slashes it came with', () => {
        expect(normalizeSubpath('104CANON/')).toBe('104CANON');
        expect(normalizeSubpath('/104CANON')).toBe('104CANON');
        expect(normalizeSubpath('Loja 1//104CANON')).toBe('Loja 1/104CANON');
    });

    it('treats a path with no folder in it as none', () => {
        expect(normalizeSubpath('')).toBeUndefined();
        expect(normalizeSubpath('//')).toBeUndefined();
        expect(normalizeSubpath(undefined)).toBeUndefined();
    });
});
