import { defineConfig, defaultExclude } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite@7 plugin types from @vitejs/plugin-react are incompatible with vite@6 types from vitest
    plugins: [react() as any],
    test: {
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['**/*.test.{ts,tsx}'],
        exclude: [...defaultExclude, '**/*.integration.test.*'],
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
            '@': path.resolve(__dirname, './'),
        },
    },
});
