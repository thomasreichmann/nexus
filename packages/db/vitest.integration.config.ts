import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// The real-DB tier for repository and query code: `*.integration.test.ts`
// next to the code under test, written against the fixtures in
// `@nexus/db/test-db/integration`. See docs/conventions/testing.md.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.integration.test.ts'],
        setupFiles: ['./vitest.integration.setup.ts'],
        // A real (often remote) Postgres: see apps/web's integration config
        // for why 20s (#471).
        testTimeout: 20_000,
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
