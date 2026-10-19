import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { resolveEntryNames } from './entryNames';

type Source = Parameters<typeof resolveEntryNames>[0][number];

function file(
    name: string,
    subpath: string | null = null,
    entryName: string | null = null
): Source {
    return { name, subpath, entryName };
}

describe('resolveEntryNames', () => {
    it('keeps the folder each file was uploaded from', () => {
        expect(
            resolveEntryNames([
                file('IMG_0001.JPG', '104CANON'),
                file('IMG_0001.JPG', '105CANON/RAW'),
                file('notes.txt'),
            ])
        ).toEqual([
            '104CANON/IMG_0001.JPG',
            '105CANON/RAW/IMG_0001.JPG',
            'notes.txt',
        ]);
    });

    // Burst siblings from two shoots are routinely both `_MG_4501.CR2`, and a
    // zip with duplicate entry names silently loses one on extraction.
    it('numbers a clash on the file’s own name, inside its folder', () => {
        expect(
            resolveEntryNames([
                file('_MG_4501.CR2', 'A'),
                file('_MG_4501.CR2', 'A'),
                file('_MG_4501.CR2', 'A'),
            ])
        ).toEqual([
            'A/_MG_4501.CR2',
            'A/_MG_4501 (2).CR2',
            'A/_MG_4501 (3).CR2',
        ]);
    });

    // macOS and Windows extract both onto one file.
    it('treats names that differ only in case as a clash', () => {
        expect(
            resolveEntryNames([file('IMG_0001.JPG'), file('img_0001.jpg')])
        ).toEqual(['IMG_0001.JPG', 'img_0001 (2).jpg']);
    });

    it('numbers a file with no extension, even inside a dotted folder', () => {
        expect(
            resolveEntryNames([file('README', 'v1.2'), file('README', 'v1.2')])
        ).toEqual(['v1.2/README', 'v1.2/README (2)']);
    });

    // A chunk partitioned before names were stored is named by its own build,
    // and a name a file already has was shipped in some part already.
    it('keeps an entry name a file already has, and steers new ones around it', () => {
        expect(
            resolveEntryNames([
                file('IMG_0001.JPG'),
                file('IMG_0001.JPG', null, 'IMG_0001.JPG'),
            ])
        ).toEqual(['IMG_0001 (2).JPG', 'IMG_0001.JPG']);
    });

    it('never names a path outside the extraction folder', () => {
        expect(
            resolveEntryNames([
                file('passwd', '../../etc'),
                file('passwd', ' .. / .. /etc'),
                file('../../etc/shadow'),
                file('.hidden', './.config'),
            ])
        ).toEqual([
            'etc/passwd',
            'etc/passwd (2)',
            '_.._etc_shadow',
            'config/hidden',
        ]);
    });

    // Finder shows a folder named "B/W prints" and stores it as `B:W prints`,
    // which a zip writer reads as a drive letter.
    it('keeps a colon from reading as a drive letter', () => {
        expect(
            resolveEntryNames([
                file('IMG.JPG', 'B:W prints'),
                file('C:notes.txt'),
            ])
        ).toEqual(['B_W prints/IMG.JPG', 'C_notes.txt']);
    });

    // Extracting `RAW` the file first would leave nowhere for `RAW/` the
    // folder, and every file in it would be lost.
    it('never gives a file the path of a folder another file sits in', () => {
        expect(
            resolveEntryNames([
                file('raw'),
                file('IMG.CR2', 'RAW/2026'),
                file('2026', 'RAW'),
            ])
        ).toEqual(['raw (2)', 'RAW/2026/IMG.CR2', 'RAW/2026 (2)']);
    });

    // macOS hands over names decomposed; a name typed elsewhere arrives
    // composed. Both extract to one file.
    it('treats the composed and decomposed forms of a name as a clash', () => {
        const composed = 'café.jpg';
        const decomposed = 'café.jpg';

        expect(resolveEntryNames([file(composed), file(decomposed)])).toEqual([
            composed,
            'café (2).jpg',
        ]);
    });

    // A name the writer refuses is stored with the partition, so it would
    // fail that part's build on every retry: whatever comes in, what comes
    // out must be one yazl accepts.
    it('only names paths a zip writer accepts', () => {
        const names = resolveEntryNames([
            file('a.jpg', ' ../ ../etc'),
            file('a.jpg', 'C:'),
            file('a.jpg', '/abs/olute'),
            file('a.jpg', '\\\\server\\share'),
            file('a.jpg', '. . /.'),
            file('C:x.jpg'),
            file('..'),
            file(' '),
            file('/'),
        ]);

        const zip = new ZipFile();
        expect(() =>
            names.forEach((name) => zip.addBuffer(Buffer.alloc(0), name))
        ).not.toThrow();
    });
});
