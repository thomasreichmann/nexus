import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['./vitest.integration.setup.ts'],
        include: ['**/*.integration.test.ts'],
        // These talk to a real (often remote) Postgres: a test is dozens of
        // round trips and routinely runs 3–5s, so vitest's 5s default flakes
        // under parallel load (#471). 20s leaves ~4x headroom while a truly
        // hung test still fails in reasonable time.
        testTimeout: 20_000,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './'),
        },
    },
});
