import { describe, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { createTRPCDevtools } from './handler';

// Standalone assets are embedded at build time; stub them so the handler can
// render HTML from source during tests.
vi.mock('./assets', () => ({
    getStandaloneJs: () => 'const html = "<script></script>";',
    getStandaloneCss: () => '/* standalone css */',
}));

const t = initTRPC.create();
const router = t.router({
    hello: t.procedure.query(() => 'world'),
});

function makeRequest(url: string): NextRequest {
    return new Request(url) as unknown as NextRequest;
}

function makeContext(devtools?: string[]) {
    return { params: Promise.resolve({ devtools }) };
}

describe('createTRPCDevtools handler', () => {
    const handler = createTRPCDevtools({ router, url: '/api/trpc' });

    it('serves the devtools HTML with a mobile viewport meta tag', async () => {
        const response = await handler(
            makeRequest('http://localhost/api/trpc-devtools'),
            makeContext()
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/html');

        const html = await response.text();
        expect(html).toContain(
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        );
    });

    it('escapes closing script tags in the embedded bundle', async () => {
        const response = await handler(
            makeRequest('http://localhost/api/trpc-devtools'),
            makeContext()
        );

        const html = await response.text();
        // The raw "</script>" from the bundle must not survive embedding,
        // or the HTML parser terminates the inline script block early.
        expect(html).toContain('const html = "<script><\\/script>";');
    });

    it('serves the introspected schema as JSON', async () => {
        const response = await handler(
            makeRequest('http://localhost/api/trpc-devtools/schema'),
            makeContext(['schema'])
        );

        expect(response.status).toBe(200);
        const schema = await response.json();
        expect(schema.procedures).toHaveLength(1);
        expect(schema.procedures[0].path).toBe('hello');
    });

    it('returns 404 for unknown routes', async () => {
        const response = await handler(
            makeRequest('http://localhost/api/trpc-devtools/nope'),
            makeContext(['nope'])
        );

        expect(response.status).toBe(404);
    });
});
