import { describe, expect, it } from 'vitest';
import { compareFilesByName, originalKey } from './files';

// The pure parts of the files repository. Everything that runs as SQL is in
// files.integration.test.ts, against a real database.

describe('originalKey', () => {
    it('builds the four-segment upload key', () => {
        expect(
            originalKey({
                userId: 'usr_1',
                batchId: 'batch_1',
                id: 'file_1',
                name: '_MG_4501.CR2',
            })
        ).toBe('usr_1/batch_1/file_1/_MG_4501.CR2');
    });
});

// The order of files within a batch (#404). The query returns them newest
// upload first, which the concurrent upload lanes make effectively random.
describe('compareFilesByName', () => {
    const EARLIER = new Date('2026-08-01T10:00:00Z');
    const LATER = new Date('2026-08-01T10:05:00Z');
    const file = (name: string, createdAt = EARLIER, id = name) => ({
        id,
        name,
        createdAt,
    });
    const sorted = (files: ReturnType<typeof file>[]) =>
        [...files].sort(compareFilesByName);

    it('orders by natural filename, the order cameras write', () => {
        const files = ['IMG_2.JPG', 'IMG_10.JPG', 'IMG_1.JPG', 'IMG_9.JPG'];

        expect(
            sorted(files.map((name) => file(name))).map((f) => f.name)
        ).toEqual(['IMG_1.JPG', 'IMG_2.JPG', 'IMG_9.JPG', 'IMG_10.JPG']);
    });

    // Ids run against upload time here, so each tie-break is seen on its own.
    it('breaks filename ties by upload time, then id', () => {
        const files = [
            file('IMG_0001.JPG', EARLIER, 'f-c'),
            file('IMG_0001.JPG', LATER, 'f-a'),
            file('IMG_0001.JPG', EARLIER, 'f-b'),
        ];

        expect(sorted(files).map((f) => f.id)).toEqual(['f-b', 'f-c', 'f-a']);
    });

    // Same name, same upload time: only the id decides. Asserted on the comparator itself, in both directions and
    // for equal rows, because a short sort only ever asks one way round and
    // would hide a comparator that isn't consistent.
    it('orders a full name-and-time tie by id, either way round', () => {
        const low = file('IMG_0001.JPG', EARLIER, 'f-a');
        const high = file('IMG_0001.JPG', EARLIER, 'f-b');

        expect(compareFilesByName(low, high)).toBeLessThan(0);
        expect(compareFilesByName(high, low)).toBeGreaterThan(0);
        expect(compareFilesByName(low, { ...low })).toBe(0);
    });

    // The numeric collator compares IMG_0001 and IMG_1 as equal, so their
    // relative order comes from the tie-break, not the zeros.
    it('treats leading zeros as numerically equal and breaks the tie by upload time', () => {
        const files = [
            file('IMG_10.JPG'),
            file('IMG_0001.JPG', LATER),
            file('IMG_0002.JPG'),
            file('IMG_1.JPG'),
        ];

        expect(sorted(files).map((f) => f.name)).toEqual([
            'IMG_1.JPG',
            'IMG_0001.JPG',
            'IMG_0002.JPG',
            'IMG_10.JPG',
        ]);
    });

    // Case never outranks the number, so camera-name casing differences
    // don't split a sequence apart.
    it('orders mixed-case names numerically, lowercase first when only case differs', () => {
        const files = [
            'IMG_10.JPG',
            'IMG_2.JPG',
            'img_9.jpg',
            'img_2.jpg',
            'Img_1.jpg',
        ];

        expect(
            sorted(files.map((name) => file(name))).map((f) => f.name)
        ).toEqual([
            'Img_1.jpg',
            'img_2.jpg',
            'IMG_2.JPG',
            'img_9.jpg',
            'IMG_10.JPG',
        ]);
    });
});
