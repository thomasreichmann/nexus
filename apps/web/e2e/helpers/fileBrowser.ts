import { expect, type Page } from '@playwright/test';

/**
 * Runs the file browser's bulk-delete confirmation: the selection bar's Delete
 * button, the "Delete N files?" dialog, then the dialog's own Delete action.
 *
 * The trigger and the dialog action share an accessible name, so the action can
 * only be told apart positionally. Kept here so that fragility lives in one
 * place instead of in every spec that deletes.
 */
export async function confirmBulkDelete(
    page: Page,
    fileCount: number
): Promise<void> {
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(
        page.getByText(`Delete ${fileCount} file${fileCount > 1 ? 's' : ''}?`)
    ).toBeVisible();

    await page
        .getByRole('button', { name: 'Delete', exact: true })
        .last()
        .click();
}
