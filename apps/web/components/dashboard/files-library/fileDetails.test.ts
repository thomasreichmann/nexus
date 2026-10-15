import { describe, expect, it } from 'vitest';
import { describeKind, findCompanions, getOriginalKind } from './fileDetails';

const file = (id: string, name: string, subpath: string | null = null) => ({
    id,
    name,
    subpath,
});

describe('findCompanions', () => {
    it('finds the same shot in its other formats', () => {
        const raw = file('1', 'DSC_0001.NEF');
        const files = [
            raw,
            file('2', 'DSC_0001.JPG'),
            file('3', 'dsc_0001.xmp'),
            file('4', 'DSC_0002.JPG'),
        ];

        expect(findCompanions(files, raw).map((f) => f.id)).toEqual(['2', '3']);
    });

    // Camera folders restart their numbering on every card (#405): the
    // next card's DSC_0001 is another photo.
    it('looks only in the file’s own folder', () => {
        const raw = file('1', 'DSC_0001.NEF', '104CANON');
        const files = [
            raw,
            file('2', 'DSC_0001.JPG', '104CANON'),
            file('3', 'DSC_0001.JPG', '105CANON'),
            file('4', 'DSC_0001.JPG'),
        ];

        expect(findCompanions(files, raw).map((f) => f.id)).toEqual(['2']);
    });

    // Only the format's extension comes off: "Party 2.5" is a shot of its
    // own, not another format of "Party 2".
    it('reads a dotted name up to its last dot as the shot', () => {
        const raw = file('1', 'Party 2.5.NEF');
        const files = [
            raw,
            file('2', 'Party 2.5.JPG'),
            file('3', 'Party 2.JPG'),
        ];

        expect(findCompanions(files, raw).map((f) => f.id)).toEqual(['2']);
    });
});

describe('describeKind / getOriginalKind', () => {
    it('names camera RAW formats and keeps them out of in-browser viewing', () => {
        expect(describeKind('IMG_0001.CR3')).toBe('Canon RAW');
        expect(getOriginalKind('IMG_0001.CR3')).toBeNull();
        expect(getOriginalKind('IMG_0001.JPG')).toBe('image');
        expect(getOriginalKind('clip.MOV')).toBe('video');
    });
});
