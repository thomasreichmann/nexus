/**
 * Coverage scope shared by the unit and integration configs.
 *
 * `include` is what makes coverage honest: without it Vitest only reports
 * the files some test happens to import, so an untested file disappears
 * instead of showing up at 0% (#492). Config-only entrypoints
 * (`next.config.ts`, `sentry.*.config.ts`, `instrumentation-client.ts`) are
 * left out on purpose.
 */
export const coverageInclude = [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'server/**/*.{ts,tsx}',
    'scripts/**/*.{ts,tsx}',
    'instrumentation.ts',
    'proxy.ts',
];

export const coverageExclude = [
    // Test files of every tier, not just the running one: the integration
    // run would otherwise count the unit tests as untested source.
    '**/*.test.{ts,tsx}',
    '**/__tests__/**',
    '**/fixtures*',
    '**/mocks*',
    '**/test-utils*',
    '**/testing*',
    '**/vitest.setup*',
];
