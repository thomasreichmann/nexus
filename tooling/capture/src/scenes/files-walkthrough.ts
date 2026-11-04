import { defineScene } from '../scene';
import type { Page } from '@playwright/test';

/** A sidebar link, filtered to the visible one (the mobile nav renders its own copy). */
function navLink(page: Page, name: string) {
    return page
        .getByRole('link', { name, exact: true })
        .filter({ visible: true });
}

/**
 * The README walkthrough: the storage overview, then the archived library as
 * a shelf of shoots, one opened into its photos, a multi-select with the bulk
 * Retrieve, a photo in the viewer, and finally the upload surface. Writes to
 * .github/assets/demo.{gif,mp4}.
 *
 * To refresh after a UI change: `pnpm capture files-walkthrough`.
 */
export default defineScene<void>({
    name: 'files-walkthrough',
    description:
        'Storage overview → archived shoots → open one, multi-select + bulk restore → viewer → upload.',
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

        // Warm-up, before the first action so it's trimmed off the clip. A
        // fresh dev server compiles each route on first visit, and the library
        // and batch queries take a beat; either would play as a spinner
        // mid-walkthrough. Visiting them here, then reaching the dashboard by
        // client-side navigation, keeps the query cache for the recorded run.
        await stage.goto('/dashboard/upload');
        await navLink(page, 'Dashboard').waitFor();
        await stage.goto('/dashboard/files');
        await page
            .getByRole('button', { name: 'Open Launch Dinner — Catering' })
            .click();
        await page
            .getByRole('checkbox', { name: 'Select rose-tart.CR3' })
            .waitFor({ timeout: 45_000 });
        await navLink(page, 'Dashboard').click();

        // --- Dashboard: storage overview ---
        // The card titles render with the skeleton; wait for the data itself.
        await stage.waitFor('text=Storage by Type');
        // Only the shared <Skeleton> pulses, so none left means every card
        // (and the sidebar's storage bar) has its data.
        await page.waitForFunction(
            () => document.querySelector('.animate-pulse') === null,
            undefined,
            { timeout: 45_000 }
        );
        await stage.settle();
        await stage.move(page.getByText('Storage by Type').first());
        await stage.move(page.getByText('Storage Usage').first());

        // --- Files: the library of shoots ---
        await stage.moveClick(navLink(page, 'Files'), 300);
        // The newest shoot's card proves the seeded library has loaded.
        const shoot = page.getByRole('button', {
            name: 'Open Launch Dinner — Catering',
        });
        await shoot.waitFor({ timeout: 45_000 });
        await stage.settle(900);
        await stage.move(
            page.getByRole('button', {
                name: 'Open Showroom Opening — Interiors',
            }),
            700
        );

        // Open a shoot: its cover photos fly into the batch list.
        await stage.moveClick(shoot, 1400);

        // Select a few frames — the bulk action bar appears.
        for (const name of [
            'rose-tart.CR3',
            'table-greens.CR3',
            'pastry-table.CR3',
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
            page.getByRole('button', { name: 'Open rose-tart.CR3' }).first(),
            1600
        );
        await stage.moveClick(
            page.getByRole('button', { name: 'Close viewer' }),
            900
        );

        // --- Upload ---
        await stage.moveClick(navLink(page, 'Upload'), 300);
        const dropZone = page.getByText('Drop files or folders here to upload');
        await dropZone.waitFor();
        await stage.settle(600);
        await stage.move(dropZone, 1200);
    },
});
