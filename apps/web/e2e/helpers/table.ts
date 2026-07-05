import type { Page } from '@playwright/test';

/**
 * Waits for a data-table page to finish loading: either the table itself or
 * the page's empty-state text, whichever renders first.
 */
export async function waitForTableLoad(
    page: Page,
    emptyStateText: string
): Promise<void> {
    await page
        .locator('table')
        .or(page.getByText(emptyStateText))
        .first()
        .waitFor({ timeout: 10_000 });
}
