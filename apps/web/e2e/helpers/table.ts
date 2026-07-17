import type { Locator, Page } from '@playwright/test';

/**
 * Locates a file by (sub)string of its name in the file list, tolerant of the
 * dual mobile/desktop markup and MiddleTruncateName's twin copies (a full
 * sr-only span + a fitted aria-hidden span). Each name renders several times,
 * so a bare `getByText(name)` trips Playwright strict mode — scope to the
 * visible copy and take the first match.
 */
export function fileName(page: Page, name: string): Locator {
    return page.getByText(name).filter({ visible: true }).first();
}

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
