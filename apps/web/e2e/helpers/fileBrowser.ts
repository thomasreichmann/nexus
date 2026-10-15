import { expect, type Locator, type Page } from '@playwright/test';

/**
 * A batch's card in the library (or its row in the open batch's list), by
 * the batch's exact name: "Ungrouped" for the legacy files with no batch.
 * Exact, so "Shoot" never also finds "Shoot 2".
 */
export function batchCard(page: Page, name: string): Locator {
    return page.getByRole('button', { name: `Open ${name}`, exact: true });
}

/**
 * The file browser (#455) opens on a library of batch cards; a batch's files
 * only load once it's opened. Opens the named batch's card and waits for its
 * pane.
 */
export async function openBatch(page: Page, name: string): Promise<void> {
    await batchCard(page, name).click();
    await expectBatchOpen(page, name);
}

/**
 * The named batch is open and at rest. Waits out the open choreography as
 * well as the heading: until it settles, a click on a tile is ignored.
 */
export async function expectBatchOpen(page: Page, name: string): Promise<void> {
    await expect(
        page.getByRole('heading', { name, exact: true, level: 2 })
    ).toBeVisible();
    await expect(page.locator('[data-phase="split"]')).toHaveCount(1);
}

/**
 * "All batches", and the library at rest again: until the close settles, the
 * batch list's own search field is on the page beside the library's.
 */
export async function backToLibrary(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'All batches' }).click();
    await expect(page.locator('[data-phase="library"]')).toHaveCount(1);
}

/**
 * A file's tile (grid) or row (list) in the open batch, by its exact name.
 * Exact, so `IMG_1.JPG` never also finds `IMG_10.JPG`: MiddleTruncateName
 * keeps the full name in the DOM for exactly this.
 */
export function fileItem(page: Page, name: string): Locator {
    return fileItems(page).filter({
        has: page.getByText(name, { exact: true }),
    });
}

/** Every file tile (grid) or row (list) the open batch has loaded. */
export function fileItems(page: Page): Locator {
    return page.locator('[data-fx="tile"]');
}

/** The open batch's folder rows (#405), in order; none for a flat batch. */
export function folderRows(page: Page): Locator {
    return page.locator('[data-fx="folder"]');
}

/** Ticks (or unticks) a file's checkbox in the open batch. */
export async function toggleFile(
    page: Page,
    name: string,
    options: { modifiers?: ('Shift' | 'Meta' | 'Control')[] } = {}
): Promise<void> {
    await page
        .getByRole('checkbox', { name: `Select ${name}`, exact: true })
        .click(options);
}

/**
 * Opens the actions menu on the file that shows `name`. The tile → Actions →
 * menu chain is the one fragile locator every file-menu spec needs, so it lives
 * here; callers pick the `menuitem` (or assert on the menu) themselves.
 */
export async function openRowMenu(page: Page, name: string): Promise<void> {
    await fileItem(page, name).getByRole('button', { name: 'Actions' }).click();
}

/**
 * Opens the file menu's Delete for the named file and returns the
 * "Delete this file?" confirmation (#403), so the caller chooses the outcome —
 * `confirmSingleDelete` for the common path, the dialog's own "Keep file" to
 * back out.
 */
export async function openSingleDeleteDialog(
    page: Page,
    name: string
): Promise<Locator> {
    await openRowMenu(page, name);
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Delete this file?')).toBeVisible();
    return dialog;
}

/** File-menu delete, confirmed: the single-file counterpart of `confirmBulkDelete`. */
export async function confirmSingleDelete(
    page: Page,
    name: string
): Promise<void> {
    const dialog = await openSingleDeleteDialog(page, name);
    await confirmDeleteDialog(dialog);
}

/**
 * Runs the file browser's bulk-delete confirmation: the selection bar's Delete
 * button, the "Delete N files?" dialog, then the dialog's own action.
 */
export async function confirmBulkDelete(
    page: Page,
    fileCount: number
): Promise<void> {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await confirmDeleteDialog(await expectDeleteDialog(page, fileCount));
}

/**
 * The open batch's menu → "Delete batch" → the "Delete N files?" confirm with
 * the batch's whole file count (#455), confirmed.
 */
export async function confirmBatchDelete(
    page: Page,
    fileCount: number
): Promise<void> {
    await page.getByRole('button', { name: 'Batch actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete batch' }).click();
    await confirmDeleteDialog(await expectDeleteDialog(page, fileCount));
}

async function expectDeleteDialog(
    page: Page,
    fileCount: number
): Promise<Locator> {
    const dialog = page.getByRole('alertdialog');
    const count = fileCount.toLocaleString('en-US');
    await expect(
        dialog.getByText(`Delete ${count} file${fileCount === 1 ? '' : 's'}?`)
    ).toBeVisible();
    return dialog;
}

/**
 * The delete dialog's destructive action is the only button in it whose label
 * starts with "Delete" ("Delete file" / "Delete N files"); the Keep button
 * never does.
 */
async function confirmDeleteDialog(dialog: Locator): Promise<void> {
    await dialog.getByRole('button', { name: /^Delete\b/ }).click();
}
