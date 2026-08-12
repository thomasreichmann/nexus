import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return { logger: createMockLogger(), execute: vi.fn() };
});

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
vi.mock('@/server/db', () => ({ db: { execute: hoisted.execute } }));

// Import after mock setup
import { GET } from './route';

describe('GET /api/health', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 200 with ok checks when the DB responds', async () => {
        hoisted.execute.mockResolvedValueOnce([{ '?column?': 1 }]);

        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: 'ok',
            checks: { db: 'ok' },
        });
    });

    it('returns 503 when the DB query throws', async () => {
        hoisted.execute.mockRejectedValueOnce(
            new Error('connect ECONNREFUSED')
        );

        const response = await GET();

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
            status: 'error',
            checks: { db: 'down' },
        });
    });

    it('keeps error details out of the response body', async () => {
        hoisted.execute.mockRejectedValueOnce(
            new Error('password authentication failed for user "app"')
        );

        const response = await GET();

        const body = JSON.stringify(await response.json());
        expect(body).not.toContain('password');
        expect(body).not.toContain('authentication');
    });
});
