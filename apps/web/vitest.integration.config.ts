import { defineConfig } from 'vitest/config';
import path from 'path';
import { coverageExclude, coverageInclude } from './vitest.coverage';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['./vitest.integration.setup.ts'],
        include: ['**/*.integration.test.ts'],
        // These talk to a real (often remote) Postgres: a test is dozens of
        // round trips and routinely runs 3–5s, so vitest's 5s default flakes
        // under parallel load (#471). 20s leaves ~4x headroom while a truly
        // hung test still fails in reasonable time. Hooks (beforeAll/afterAll
        // DB setup and teardown) make the same round trips on a separate
        // 10s default, so they get the same budget (#484).
        testTimeout: 20_000,
        hookTimeout: 20_000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            // A separate directory so a unit coverage run doesn't clean it.
            reportsDirectory: './coverage-integration',
            // These tests drive the real @nexus/db repositories, so they
            // cover packages/db too — the only tier that exercises its
            // queries against Postgres. `allowExternal` lets coverage reach
            // outside apps/web; the pattern is absolute because Vitest
            // matches include globs against absolute paths, where `../..`
            // never matches.
            include: [
                ...coverageInclude,
                `${path.resolve(__dirname, '../../packages/db/src')}/**/*.ts`,
            ],
            exclude: coverageExclude,
            allowExternal: true,
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './'),
        },
    },
});
