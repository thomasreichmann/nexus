import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens the actions menu of the row that shows `name`. The row → Actions →
 * menu chain is the one fragile locator every row-menu spec needs, so it lives
 * here; callers pick the `menuitem` (or assert on the menu) themselves.
 */
export async function openRowMenu(page: Page, name: string): Promise<void> {
    await page
        .locator('tr', { hasText: name })
        .getByRole('button', { name: 'Actions' })
        .click();
}

/**
 * Opens the row menu's Delete for the named file and returns the
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

/** Row-menu delete, confirmed: the single-file counterpart of `confirmBulkDelete`. */
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
    await page.getByRole('button', { name: 'Delete' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(
        dialog.getByText(`Delete ${fileCount} file${fileCount > 1 ? 's' : ''}?`)
    ).toBeVisible();
    await confirmDeleteDialog(dialog);
}

/**
 * The delete dialog's destructive action is the only button in it whose label
 * starts with "Delete" ("Delete file" / "Delete N files"); the Keep button
 * never does.
 */
async function confirmDeleteDialog(dialog: Locator): Promise<void> {
    await dialog.getByRole('button', { name: /^Delete\b/ }).click();
}
