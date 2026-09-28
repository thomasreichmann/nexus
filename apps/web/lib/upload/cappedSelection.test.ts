import { describe, expect, it } from 'vitest';
import { summarizeCappedSelection } from './cappedSelection';

// Driving a real over-cap gesture end-to-end would mean writing 50k files to
// disk, so the walk's cap is covered in fileSystemAccess.test.ts and only the
// event summary is unit-tested here; the dialog itself is presentational.
function picked(name: string, size: number, type = ''): { file: File } {
    return { file: new File([new Uint8Array(size)], name, { type }) };
}

describe('summarizeCappedSelection', () => {
    it('reads an archive as media-heavy and a home folder as media-light', () => {
        const archive = [
            picked('_MG_4501.CR2', 30),
            picked('_MG_4502.CR2', 30),
            picked('reel.mov', 40),
            picked('notes.txt', 1),
        ];
        expect(summarizeCappedSelection(archive)).toEqual({
            keptFiles: 4,
            keptBytes: 101,
            mediaShare: 0.75,
        });

        const home = [
            picked('index.js', 2),
            picked('package.json', 2),
            picked('avatar.png', 6),
        ];
        expect(summarizeCappedSelection(home).mediaShare).toBeCloseTo(1 / 3);
    });

    it('falls back to the mime type when the extension is unknown', () => {
        expect(
            summarizeCappedSelection([picked('export.custom', 5, 'image/png')])
                .mediaShare
        ).toBe(1);
    });

    it('reports zero share for an empty batch instead of NaN', () => {
        expect(summarizeCappedSelection([])).toEqual({
            keptFiles: 0,
            keptBytes: 0,
            mediaShare: 0,
        });
    });
});
