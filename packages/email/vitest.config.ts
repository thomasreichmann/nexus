import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // .tsx too: every template test renders its component to an HTML
        // string and asserts on that, so the tests are JSX like the templates.
        include: ['src/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            exclude: [
                '**/fixtures*',
                '**/mocks*',
                '**/test-utils*',
                '**/testing*',
                '**/vitest.setup*',
            ],
        },
    },
});
