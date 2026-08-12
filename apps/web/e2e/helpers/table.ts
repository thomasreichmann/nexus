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

/* The admin data tables (invites, jobs) all put Status second. Kept in one
   place so a column reorder breaks one selector, not assertions in three
   specs. */
const STATUS_COLUMN = 'td:nth-child(2)';

/** The status cell of a single row (a `tr` locator). */
export function statusCell(row: Locator): Locator {
    return row.locator(STATUS_COLUMN);
}

/** Every status cell in the table — for asserting a filtered view. */
export function statusCells(page: Page): Locator {
    return page.locator(`tbody ${STATUS_COLUMN}`);
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
