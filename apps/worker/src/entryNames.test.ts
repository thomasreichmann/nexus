import { describe, expect, it } from 'vitest';
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
                file('../../etc/shadow'),
                file('.hidden', './.config'),
            ])
        ).toEqual(['etc/passwd', '_.._etc_shadow', 'config/hidden']);
    });
});
