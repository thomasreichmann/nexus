/**
 * Downscaled local previews for upload queue rows.
 *
 * The raw File must never reach an <img>: the browser decodes the whole image
 * to paint even a 40px tile, and a 50-photo camera batch is gigabytes of
 * decoded bitmap (#390). Each image is decoded once, scaled so its short side
 * fits the tile, and re-encoded as a tiny blob whose object URL is what the
 * tile renders. Cached per File because virtualized rows unmount on scroll —
 * a remount must be a cache hit, not a re-decode.
 *
 * URLs are deliberately never revoked: the cache owns them for the session,
 * several tiles can share one concurrently, and the blobs they pin are
 * kilobytes.
 */

/* Tile short side at 2x DPR (the tile renders at 40px), with slack so
   object-cover never upscales. */
const TILE_SOURCE_PX = 96;

const previewUrlCache = new WeakMap<File, Promise<string | null>>();

/**
 * Object URL for a tile-sized preview of an image file, or null when the file
 * can't be decoded (the tile keeps its plain icon). No failure path may
 * return the raw file's URL — that would reinstate the full-size decode this
 * module exists to eliminate.
 */
export function getImagePreviewUrl(file: File): Promise<string | null> {
    let cached = previewUrlCache.get(file);
    if (!cached) {
        cached = createTilePreviewUrl(file);
        previewUrlCache.set(file, cached);
    }
    return cached;
}

async function createTilePreviewUrl(file: File): Promise<string | null> {
    try {
        const bitmap = await createImageBitmap(file);
        try {
            // Short side lands on TILE_SOURCE_PX so cover-fitting the square
            // tile stays crisp for any aspect ratio; small images pass through
            // unscaled.
            const scale = Math.min(
                TILE_SOURCE_PX / Math.min(bitmap.width, bitmap.height),
                1
            );
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            const blob = await drawToBlob(bitmap, width, height);
            return blob ? URL.createObjectURL(blob) : null;
        } finally {
            // Release the full-size decode immediately — retaining it is the
            // exact cost this module exists to avoid.
            bitmap.close();
        }
    } catch {
        // Undecodable (corrupt file, exotic subtype the mime check let
        // through) — the tile falls back to its plain icon.
        return null;
    }
}

function drawToBlob(
    bitmap: ImageBitmap,
    width: number,
    height: number
): Promise<Blob | null> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.drawImage(bitmap, 0, 0, width, height);
    // webp where the encoder exists; toBlob falls back to png elsewhere,
    // which keeps transparency either way.
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
}
