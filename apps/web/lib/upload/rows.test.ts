import { describe, expect, it } from 'vitest';
import {
    patchRowById,
    patchRowsWhere,
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
