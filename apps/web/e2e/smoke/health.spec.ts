import { test, expect } from '@playwright/test';

test.describe('Health API', () => {
    // Not a page and not a user-facing use-case, so no @page/@uc tag — the
    // coverage manifest tracks UI surface only. This spec keeps the uptime
    // workflow's probe target (`.github/workflows/uptime.yml`) honest.
    test('GET /api/health reports ok', async ({ request }) => {
        const response = await request.get('/api/health');

        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({
            status: 'ok',
            checks: { db: 'ok' },
        });
    });
});
