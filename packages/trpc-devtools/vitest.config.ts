import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
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
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
