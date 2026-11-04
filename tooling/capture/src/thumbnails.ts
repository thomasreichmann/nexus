import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { THUMBNAILS_DIR } from './paths';
import type { BrowserContext } from '@playwright/test';

/** Absolute path of a committed demo thumbnail, by basename (no extension). */
export function thumbnailAsset(name: string): string {
    return join(THUMBNAILS_DIR, `${name}.webp`);
}

/**
 * Pixel size of a WebP, read from its header. The seeded rows carry it in
 * `thumbnailWidth`/`thumbnailHeight` the way the worker would, because the
 * viewer sizes the photo from those columns before the image loads.
 */
export function webpSize(path: string): { width: number; height: number } {
    const buf = readFileSync(path);
    if (buf.toString('ascii', 0, 4) !== 'RIFF')
        throw new Error(`${path}: not a WebP (no RIFF header)`);
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
        return {
            width: buf.readUInt16LE(26) & 0x3fff,
            height: buf.readUInt16LE(28) & 0x3fff,
        };
    }
    if (chunk === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1,
        };
    }
    if (chunk === 'VP8X') {
        return {
            width: buf.readUIntLE(24, 3) + 1,
            height: buf.readUIntLE(27, 3) + 1,
        };
    }
    throw new Error(`${path}: unknown WebP chunk "${chunk}"`);
}

/**
 * Serve the demo thumbnails from disk instead of the derived bucket.
 *
 * The app presigns `<userId>/<fileId>/thumb.webp` for every row whose
 * thumbnail is `ready`; the browser then GETs that URL from S3. Local
 * credentials can only read that bucket (the app's grant is GetObject-only),
 * so the seed can't upload real objects. Answering those GETs here gives the
 * same rendering with nothing to write to S3 or clean up afterwards.
 */
export async function serveThumbnails(
    context: BrowserContext,
    assetByFileId: ReadonlyMap<string, string>
): Promise<void> {
    if (assetByFileId.size === 0) return;
    await context.route(/\/thumb\.webp(\?|$)/, async (route) => {
        const { pathname } = new URL(route.request().url());
        const fileId = pathname.split('/').at(-2);
        const asset = fileId ? assetByFileId.get(fileId) : undefined;
        if (!asset) return route.continue();
        await route.fulfill({ path: asset, contentType: 'image/webp' });
    });
}
