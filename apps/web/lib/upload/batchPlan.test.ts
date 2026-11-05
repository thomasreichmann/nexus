import { describe, expect, it } from 'vitest';
import { selectDraftRows, summarizeDraft } from './batchPlan';
import { fakeFile } from './testing';
import type { UploadRow, UploadStatus } from './rows';

let nextId = 0;

/** A queued row, as one gesture's intake leaves it. */
function row(
    name: string,
    {
        size = 10,
        folderPath,
        gestureId,
        status = 'pending',
        batchId,
    }: {
        size?: number;
        folderPath?: string;
        gestureId?: number;
        status?: UploadStatus;
        batchId?: string;
    } = {}
): UploadRow {
    const root = folderPath?.split('/')[0];
    return {
        id: `row-${++nextId}`,
        name,
        size,
        progress: 0,
        status,
        file: fakeFile(name, size),
        folderPath,
        folderOrigin:
            gestureId === undefined || root === undefined
                ? undefined
                : { gestureId, name: root },
        batchId,
    };
}

// #454: the batch-to-be the upload page shows before the click.
describe('summarizeDraft', () => {
    it('outlines one dropped folder by the subfolders at its top, in natural order', () => {
        const summary = summarizeDraft([
            row('notes.txt', { folderPath: 'Library', gestureId: 1 }),
            row('a.jpg', { folderPath: 'Library/Shoot 10', gestureId: 1 }),
            row('b.jpg', {
                size: 30,
                folderPath: 'Library/Shoot 9/RAW',
                gestureId: 1,
            }),
            row('c.jpg', { folderPath: 'Library/Shoot 9', gestureId: 1 }),
        ]);

        expect(summary).toEqual({
            fileCount: 4,
            totalBytes: 60,
            folderName: 'Library',
            folders: [
                { name: 'Shoot 9', fileCount: 2 },
                { name: 'Shoot 10', fileCount: 1 },
            ],
            topLevelFileCount: 1,
            canSplit: true,
        });
    });

    it('can’t split a folder with only one subfolder', () => {
        const summary = summarizeDraft([
            row('a.jpg', { folderPath: 'Shoot/104CANON', gestureId: 1 }),
            row('notes.txt', { folderPath: 'Shoot', gestureId: 1 }),
        ]);

        expect(summary.folders).toEqual([{ name: '104CANON', fileCount: 1 }]);
        expect(summary.canSplit).toBe(false);
    });

    // Two drops and a loose file: no one folder names the batch, so the
    // dropped folders themselves are its top level, and nothing splits.
    it('outlines a mixed draft by the folders dropped, with loose files at its top', () => {
        const summary = summarizeDraft([
            row('a.jpg', { folderPath: 'Loja 1/104CANON', gestureId: 1 }),
            row('b.jpg', { folderPath: 'Loja 2', gestureId: 2 }),
            row('loose.txt'),
        ]);

        expect(summary).toMatchObject({
            folderName: undefined,
            folders: [
                { name: 'Loja 1', fileCount: 1 },
                { name: 'Loja 2', fileCount: 1 },
            ],
            topLevelFileCount: 1,
            canSplit: false,
        });
    });
});

describe('selectDraftRows', () => {
    it('takes the queued files with no batch yet, and not the ones still checked or skipped', () => {
        const draft = row('new.jpg');
        const rows = [
            draft,
            row('checking.jpg', { status: 'checking' }),
            row('duplicate.jpg', { status: 'duplicate' }),
            row('resumed.mov', { batchId: 'first-half' }),
            row('sent.jpg', { status: 'uploading' }),
            // A resumable re-listed from IndexedDB before its bytes are back.
            { ...row('no-bytes.mov'), file: null },
        ];

        expect(selectDraftRows(rows)).toEqual([draft]);
    });
});
