import { describe, expect, it } from 'vitest';
import { classifyMedia } from './media';

describe('classifyMedia', () => {
    it.each([
        ['DSC_4821.NEF', 'raw'],
        ['IMG_0042.CR3', 'raw'],
        ['shoot.ARW', 'raw'],
        ['fuji.RAF', 'raw'],
        ['scan.dng', 'raw'],
        ['photo.jpg', 'image'],
        ['photo.HEIC', 'image'],
        ['clip.mp4', 'video'],
        ['clip.MOV', 'video'],
    ])('classifies %s as %s by extension', (name, expected) => {
        expect(classifyMedia({ name, mimeType: null })).toBe(expected);
    });

    it('falls back to the mime type when the extension is unknown', () => {
        expect(
            classifyMedia({ name: 'export.custom', mimeType: 'image/png' })
        ).toBe('image');
        expect(
            classifyMedia({ name: 'export.custom', mimeType: 'video/mp4' })
        ).toBe('video');
    });

    it('extension wins over a contradicting mime type', () => {
        expect(
            classifyMedia({
                name: 'DSC_0001.NEF',
                mimeType: 'application/octet-stream',
            })
        ).toBe('raw');
    });

    it('returns null for non-media files', () => {
        expect(
            classifyMedia({ name: 'backup.zip', mimeType: 'application/zip' })
        ).toBeNull();
        expect(classifyMedia({ name: 'notes.pdf', mimeType: null })).toBeNull();
        expect(
            classifyMedia({ name: 'no-extension', mimeType: null })
        ).toBeNull();
    });

    // A leading dot is a dotfile, not an extension — `path.extname('.nef')`
    // is `''`, and the hand-rolled parser that replaced it has to agree.
    it('treats a leading dot as a dotfile, not an extension', () => {
        expect(classifyMedia({ name: '.nef', mimeType: null })).toBeNull();
    });
});
