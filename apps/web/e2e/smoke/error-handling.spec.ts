import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from '../helpers/server-url';

test.describe('Error Handling Infrastructure', () => {
    test(
        'tRPC error shows toast notification',
        { tag: ['@uc:trpc-error-toast'] },
        async ({ context, page }) => {
            // A forged session cookie slips past the optimistic proxy guard
            // (presence-only, no DB hit) but fails tRPC's protectedProcedure —
            // the "forged cookie sees the shell and 401s" invariant
            // (docs/ai/conventions.md § Auth Enforcement). /dashboard/files
            // then calls trpc.files.list, which throws UNAUTHORIZED; the
            // errorLink should surface it as a toast. React Query retries 3x
            // (~7s). Without the cookie the proxy would redirect to /sign-in
            // and no tRPC call would fire.
            await context.addCookies([
                {
                    name: 'better-auth.session_token',
                    value: 'forged-invalid-session',
                    url: E2E_BASE_URL,
                },
            ]);

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
