import { describe, expect, it } from 'vitest';
import { getImagePreviewUrl } from './thumbnails';

// jsdom has no createImageBitmap, so these cover the contract the tile relies
// on — undecodable input degrades to null (never a full-res URL), and the
// per-File cache — not the happy decode path, which the flows e2e spec
// exercises in a real browser.
describe('getImagePreviewUrl', () => {
    it('resolves null when the image cannot be decoded', async () => {
        const file = new File(['not an image'], 'photo.png', {
            type: 'image/png',
        });
        await expect(getImagePreviewUrl(file)).resolves.toBeNull();
    });

    it('caches per File: same file shares one promise, distinct files do not', () => {
        const a = new File(['a'], 'a.png', { type: 'image/png' });
        const b = new File(['b'], 'b.png', { type: 'image/png' });
        const first = getImagePreviewUrl(a);
        expect(getImagePreviewUrl(a)).toBe(first);
        expect(getImagePreviewUrl(b)).not.toBe(first);
    });
});
