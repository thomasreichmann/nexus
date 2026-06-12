import { defineConfig, devices } from '@playwright/test';

const adminChrome = {
    ...devices['Desktop Chrome'],
    storageState: 'e2e/.auth/admin.json',
};

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    // Compact terminal output (one line on success, trimmed errors +
    // artifact pointers on failure) — see e2e/reporters/compact.ts. The HTML
    // report is still written for trace debugging but never auto-opens.
    // Full per-test output: `npx playwright test --reporter=list`.
    reporter: [['./e2e/reporters/compact.ts'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /global\.setup\.ts/,
        },
        {
            name: 'smoke',
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'],
            testMatch: /smoke\/.*/,
        },
        // Admin specs all read/mutate the shared admin user's data (and the
        // global jobs table), so the spec files must never run concurrently.
        // Playwright has no per-project worker limit, so the files are
        // chained as dependent projects — serialization lives here in the
        // config, where every entrypoint (plain `playwright test`, --ui,
        // npm scripts) inherits it, instead of in a `--workers=1` flag on
        // one script. Trade-off: a failing link skips the rest of the chain.
        {
            name: 'admin-files',
            use: adminChrome,
            dependencies: ['setup'],
            testMatch: /admin\/files\.spec\.ts/,
        },
        {
            name: 'admin-jobs',
            use: adminChrome,
            dependencies: ['admin-files'],
            testMatch: /admin\/jobs\.spec\.ts/,
        },
        // Catch-all tail of the chain: new admin specs land here
        // automatically. If this project ever holds more than one spec file,
        // give the new file its own chain link above.
        {
            name: 'admin',
            use: adminChrome,
            dependencies: ['admin-jobs'],
            testMatch: /admin\/.*/,
            testIgnore: [/admin\/files\.spec\.ts/, /admin\/jobs\.spec\.ts/],
        },
        // Interactive user flows with dedicated per-spec users (created in
        // each spec's beforeAll via provisionDedicatedUser) — isolated from
        // the shared regular/admin users so exact-count and empty-state
        // assertions can't race other specs. Mutates only its own users'
        // data.
        {
            name: 'flows',
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'],
            testMatch: /flows\/.*/,
        },
        // Manual validation tier — exercises shipped functionality
        // end-to-end against the dev environment. Destructive: mutates the
        // regular user's files / storage_usage and leaves objects in the S3
        // dev bucket. Env-gated so a plain `playwright test` (or --ui) can
        // never run it alongside smoke and corrupt shared-user data; run via
        // `pnpm -F web test:e2e:validate`, which sets E2E_VALIDATE.
        ...(process.env.E2E_VALIDATE
            ? [
                  {
                      name: 'validate',
                      use: { ...devices['Desktop Chrome'] },
                      dependencies: ['setup'],
                      testMatch: /validate\/.*/,
                  },
              ]
            : []),
    ],
    webServer: {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
    },
});
