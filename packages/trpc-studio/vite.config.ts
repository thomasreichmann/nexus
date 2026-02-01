import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { embedAssetsPlugin } from './build/embed-assets-plugin';

export default defineConfig({
    plugins: [react(), tailwindcss(), embedAssetsPlugin()],
    build: {
        lib: {
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                server: resolve(__dirname, 'src/server.ts'),
            },
            formats: ['es'],
        },
        rollupOptions: {
            external: [
                'react',
                'react-dom',
                'react/jsx-runtime',
                'next',
                'next/server',
                '@trpc/server',
                '@trpc/client',
                'zod',
                'better-auth',
            ],
            output: {
                globals: {
                    react: 'React',
                    'react-dom': 'ReactDOM',
                },
                assetFileNames: 'styles[extname]',
            },
        },
        cssCodeSplit: false,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
