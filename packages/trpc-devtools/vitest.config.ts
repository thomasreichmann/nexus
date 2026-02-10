import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
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
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
