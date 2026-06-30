import { defineScene } from '../scene';

/**
 * The README walkthrough: the storage overview, then the archived library
 * grouped by shoot, a multi-select with the bulk Retrieve, a collapse/expand to
 * show the grouping, and finally the upload surface. Writes to
 * .github/assets/demo.{gif,mp4}.
 *
 * To refresh after a UI change: `pnpm capture files-walkthrough --mp4`.
 */
export default defineScene<void>({
    name: 'files-walkthrough',
    description:
        'Storage overview → archived shoots → multi-select + bulk restore → upload.',
    viewport: { width: 1440, height: 900 },
    output: {
        name: 'demo',
        gif: true,
        mp4: true,
        // 1.25x keeps the pacing snappy; the smooth scroll still reads as motion.
        speed: 1.25,
        // The scroll fills many frames with full-frame motion — costly for a GIF
        // (no interframe compression), so quality leans down to hold demo.gif
        // under ~800KB at native 760px / 12fps. The flat dark UI stays legible.
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

        // --- Files: the archived library ---
        await stage.goto('/dashboard/files');
        // The top shoot's name rendering proves the seeded library has loaded.
        await stage.waitFor('text=Client Deliverables — Q2 2026');
        await stage.settle();

        // Select a few files across shoots — the bulk action bar appears.
        await stage.moveClick(
            page.getByRole('button', {
                name: 'Select contract-marquez-signed.pdf',
            }),
            700
        );
        await stage.moveClick(
            page.getByRole('button', {
                name: 'Select smith-wedding-gallery.zip',
            }),
            700
        );
        await stage.moveClick(
            page.getByRole('button', { name: 'Select highlights-reel.mov' }),
            700
        );

        // Rest on the bulk Retrieve (enabled — an archived file is selected).
        await stage.move(
            page.getByRole('button', { name: 'Retrieve', exact: true }),
            1100
        );

        // Collapse then re-expand a shoot further down the list. This is the
        // scroll that used to teleport; the smooth scroll keeps it readable.
        const shoot = page.getByRole('button', { name: /Studio Portraits/ });
        await stage.moveClick(shoot, 900);
        await stage.moveClick(shoot, 900);

        // Clear the selection.
        await stage.moveClick(
            page.getByRole('button', { name: 'Clear selection' }),
            800
        );

        // --- Upload ---
        await stage.goto('/dashboard/upload');
        await stage.waitFor('text=Drop files here to upload');
        await stage.settle();
        await stage.move(page.getByText('Drop files here to upload'), 1200);
    },
});
