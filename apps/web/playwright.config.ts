import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
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
        {
            name: 'admin',
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'e2e/.auth/admin.json',
            },
            dependencies: ['setup'],
            testMatch: /admin\/.*/,
        },
        // Manual validation tier — exercises shipped functionality end-to-end
        // against the dev environment. Destructive: mutates the regular user's
        // files / storage_usage and leaves objects in the S3 dev bucket. Not
        // wired into `pnpm check` or CI; run explicitly via
        // `pnpm -F web test:e2e:validate`. Specs run serially (`workers=1`
        // forced at script level) since they share the regular user.
        {
            name: 'validate',
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'],
            testMatch: /validate\/.*/,
        },
    ],
    webServer: {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
    },
});
