import { defineScene } from '../scene';

/**
 * The README walkthrough: the storage overview, then the archived library as
 * a shelf of shoots, one opened into its photos, a multi-select with the bulk
 * Retrieve, a photo in the viewer, and finally the upload surface. Writes to
 * .github/assets/demo.{gif,mp4}.
 *
 * To refresh after a UI change: `pnpm capture files-walkthrough --mp4`.
 */
export default defineScene<void>({
    name: 'files-walkthrough',
    description:
        'Storage overview → archived shoots → open one, multi-select + bulk restore → upload.',
    viewport: { width: 1440, height: 900 },
    output: {
        name: 'demo',
        gif: true,
        mp4: true,
        // 1.25x keeps the pacing snappy; the smooth scroll still reads as motion.
        speed: 1.25,
        // The open choreography fills many frames with full-frame motion —
        // costly for a GIF (no interframe compression), so quality leans down
        // to hold demo.gif under ~800KB at native 760px / 12fps. The flat dark
        // UI stays legible.
        gifWidth: 760,
        gifFps: 12,
        quality: 60,
    },
    setup: async (ctx) => {
        await ctx.seedDemoLibrary();
    },
    record: async (stage) => {
        const page = stage.raw;

        // --- Dashboard: storage overview ---
        await stage.goto('/dashboard');
        await stage.waitFor('text=Storage by Type');
        await stage.settle();
        await stage.move(page.getByText('Storage by Type').first());
        await stage.move(page.getByText('Storage Usage').first());

        // --- Files: the library of shoots ---
        await stage.goto('/dashboard/files');
        // The newest shoot's card proves the seeded library has loaded.
        const shoot = page.getByRole('button', {
            name: 'Open Marquez Wedding — June 2026',
        });
        await stage.waitFor('text=Marquez Wedding — June 2026');
        await stage.settle();
        await stage.move(
            page.getByRole('button', {
                name: 'Open Client Deliverables — Q2 2026',
            }),
            700
        );

        // Open a shoot: its cover photos fly into the batch list.
        await stage.moveClick(shoot, 1400);

        // Select a few frames — the bulk action bar appears.
        for (const name of [
            'ceremony-0148.NEF',
            'first-dance.NEF',
            'highlights-reel.mov',
        ]) {
            await stage.moveClick(
                page.getByRole('checkbox', { name: `Select ${name}` }),
                600
            );
        }

        // Rest on the bulk Retrieve (enabled — archived files are selected).
        await stage.move(
            page.getByRole('button', { name: 'Retrieve', exact: true }),
            1100
        );
        await stage.moveClick(
            page.getByRole('button', { name: 'Clear selection' }),
            800
        );

        // One photo, opened into the viewer, then home again.
        await stage.moveClick(
            page
                .getByRole('button', { name: 'Open couple-golden-hour.CR2' })
                .first(),
            1400
        );
        await stage.moveClick(
            page.getByRole('button', { name: 'Close viewer' }),
            900
        );

        // --- Upload ---
        await stage.goto('/dashboard/upload');
        await stage.waitFor('text=Drop files here to upload');
        await stage.settle();
        await stage.move(page.getByText('Drop files here to upload'), 1200);
    },
});
