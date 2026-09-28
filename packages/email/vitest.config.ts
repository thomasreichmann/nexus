import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // .tsx too: every template test renders its component to an HTML
        // string and asserts on that, so the tests are JSX like the templates.
        include: ['src/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            // Count every source file, not only the ones a test imports:
            // an untested file must show up at 0% (#492).
            include: ['src/**/*.{ts,tsx}'],
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
