import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// The real-DB tier for the worker: `*.integration.test.ts` next to the code
// under test, written against the fixtures in `@nexus/db/test-db/integration`.
// A job handler is a controller over the DB, so what it writes is asserted on
// the rows, not on a mocked chain. See docs/conventions/testing.md.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.integration.test.ts'],
        setupFiles: ['./vitest.integration.setup.ts'],
        // A real (often remote) Postgres: see apps/web's integration config
        // for why 20s (#471), and for hooks too (#484).
        testTimeout: 20_000,
        hookTimeout: 20_000,
        coverage: {
            ...baseConfig.test?.coverage,
            // Vitest leaves out of coverage only the files this config's
            // `include` matches, so the unit tests would count as source.
            exclude: [
                ...(baseConfig.test?.coverage?.exclude ?? []),
                '**/*.test.ts',
            ],
            // A separate directory so a unit coverage run doesn't clean it.
            reportsDirectory: './coverage-integration',
        },
    },
});
