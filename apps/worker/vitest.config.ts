import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            // Count every source file, not only the ones a test imports:
            // an untested file must show up at 0% (#492).
            include: ['src/**/*.ts'],
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
