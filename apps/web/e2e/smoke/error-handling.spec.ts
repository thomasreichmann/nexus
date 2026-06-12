import { test, expect } from '@playwright/test';

test.describe('Error Handling Infrastructure', () => {
    test(
        'tRPC error shows toast notification',
        { tag: ['@uc:trpc-error-toast'] },
        async ({ page }) => {
            // /dashboard/files calls trpc.files.list (protectedProcedure),
            // which throws UNAUTHORIZED without auth. The errorLink should
            // surface this as a toast. React Query retries 3x (~7s).

            await page.goto('/dashboard/files');

            // Wait for the toast element to appear in the DOM
            // Sonner renders toasts as <li> with data-sonner-toast attribute
            const toast = page.locator('[data-sonner-toast]').first();
            await expect(toast).toBeAttached({ timeout: 15_000 });

            // Verify toast appeared with an error message
            await expect(toast).toContainText('UNAUTHORIZED', {
                timeout: 5_000,
            });
        }
    );

    // route-error-boundary and global-error-boundary are `excluded` in the
    // coverage manifest (with reasons) rather than covered by assertion-free
    // placeholder tests — a test with no expects would mark them "covered"
    // while verifying nothing.
});
