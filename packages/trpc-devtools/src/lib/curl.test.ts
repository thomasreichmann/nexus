import { describe, expect, it } from 'vitest';
import { buildCurlCommand, shellQuote } from './curl';

const ORIGIN = 'https://app.example.com';

describe('shellQuote', () => {
    it('wraps in single quotes', () => {
        expect(shellQuote('hello')).toBe(`'hello'`);
    });

    it('escapes embedded single quotes', () => {
        expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    });

    it('leaves double quotes and dollar signs inert', () => {
        expect(shellQuote('say "$HOME"')).toBe(`'say "$HOME"'`);
    });
});

describe('buildCurlCommand', () => {
    it('builds a GET with url-encoded input for queries', () => {
        const cmd = buildCurlCommand(
            { path: 'files.list', type: 'query', input: { limit: 10 } },
            { trpcUrl: '/api/trpc', origin: ORIGIN }
        );

        expect(cmd).toContain(
            `curl 'https://app.example.com/api/trpc/files.list?input=%7B%22limit%22%3A10%7D'`
        );
        expect(cmd).not.toContain('-X POST');
    });

    it('omits the input param for queries without input', () => {
        const cmd = buildCurlCommand(
            { path: 'health.ping', type: 'query' },
            { trpcUrl: '/api/trpc', origin: ORIGIN }
        );

        expect(cmd).toBe(`curl 'https://app.example.com/api/trpc/health.ping'`);
    });

    it('builds a POST with a JSON body for mutations', () => {
        const cmd = buildCurlCommand(
            { path: 'files.rename', type: 'mutation', input: { id: 'a' } },
            { trpcUrl: '/api/trpc', origin: ORIGIN }
        );

        expect(cmd).toContain(
            `curl -X POST 'https://app.example.com/api/trpc/files.rename'`
        );
        expect(cmd).toContain(`-H 'Content-Type: application/json'`);
        expect(cmd).toContain(`--data '{"id":"a"}'`);
    });

    it('sends an empty object body for mutations without input', () => {
        const cmd = buildCurlCommand(
            { path: 'files.touch', type: 'mutation' },
            { trpcUrl: '/api/trpc', origin: ORIGIN }
        );

        expect(cmd).toContain(`--data '{}'`);
    });

    it('wraps input in SuperJSON format when enabled', () => {
        const query = buildCurlCommand(
            { path: 'files.list', type: 'query', input: { limit: 1 } },
            { trpcUrl: '/api/trpc', origin: ORIGIN, useSuperJSON: true }
        );
        const mutation = buildCurlCommand(
            { path: 'files.rename', type: 'mutation', input: { id: 'a' } },
            { trpcUrl: '/api/trpc', origin: ORIGIN, useSuperJSON: true }
        );

        expect(query).toContain(
            encodeURIComponent('{"json":{"limit":1}}').replace(/'/g, '')
        );
        expect(mutation).toContain(`--data '{"json":{"id":"a"}}'`);
    });

    it('includes custom headers', () => {
        const cmd = buildCurlCommand(
            { path: 'files.list', type: 'query' },
            {
                trpcUrl: '/api/trpc',
                origin: ORIGIN,
                headers: { 'x-api-key': 'secret', 'x-trace': '1' },
            }
        );

        expect(cmd).toContain(`-H 'x-api-key: secret'`);
        expect(cmd).toContain(`-H 'x-trace: 1'`);
    });

    it('includes cookies only when a cookie header is provided', () => {
        const withCookies = buildCurlCommand(
            { path: 'files.list', type: 'query' },
            { trpcUrl: '/api/trpc', origin: ORIGIN, cookieHeader: 'a=1; b=2' }
        );
        const withoutCookies = buildCurlCommand(
            { path: 'files.list', type: 'query' },
            { trpcUrl: '/api/trpc', origin: ORIGIN, cookieHeader: '' }
        );

        expect(withCookies).toContain(`-b 'a=1; b=2'`);
        expect(withoutCookies).not.toContain('-b ');
    });

    it('escapes shell-hostile input safely', () => {
        const cmd = buildCurlCommand(
            {
                path: 'files.rename',
                type: 'mutation',
                input: { name: `it's; rm -rf "$HOME"` },
            },
            { trpcUrl: '/api/trpc', origin: ORIGIN }
        );

        expect(cmd).toContain(`'\\''`);
        expect(cmd).toContain('rm -rf');
        // The body stays inside a single-quoted string
        expect(cmd).toMatch(/--data '.*'$/s);
    });

    it('resolves an absolute trpcUrl without using origin', () => {
        const cmd = buildCurlCommand(
            { path: 'files.list', type: 'query' },
            { trpcUrl: 'https://other.example.com/trpc', origin: ORIGIN }
        );

        expect(cmd).toContain('https://other.example.com/trpc/files.list');
    });
});
