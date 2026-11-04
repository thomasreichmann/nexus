import { defineScene } from '../scene';

/**
 * The README's library still: one shoot opened into its photos, with a
 * restore in flight on the batch. Writes .github/assets/files.png
 * (2880x1800, the 1440x900 viewport at 2x).
 *
 * To refresh after a UI change: `pnpm capture files-still`.
 */
export default defineScene<void>({
    name: 'files-still',
    description: 'PNG: an opened shoot with a restore in progress.',
    viewport: { width: 1440, height: 900 },
    output: { still: true },
    setup: async (ctx) => {
        await ctx.seedDemoLibrary();
    },
    record: async (stage) => {
        const page = stage.raw;
        await stage.goto('/dashboard/files');
        await stage.moveClick(
            page.getByRole('button', { name: 'Open Launch Dinner — Catering' }),
            0
        );
        // The batch pane is up once its tiles are; let every thumbnail decode
        // and the open choreography finish before the shot.
        await page
            .getByRole('checkbox', { name: 'Select rose-tart.CR3' })
            .waitFor();
        // On-screen images only: lazy ones below the fold never load.
        await page.waitForFunction(() =>
            Array.from(document.images)
                .filter((img) => {
                    const r = img.getBoundingClientRect();
                    return r.bottom > 0 && r.top < window.innerHeight;
                })
                .every((img) => img.complete && img.naturalWidth > 0)
        );
        await stage.settle(1500);
        await stage.still('files');
    },
});
