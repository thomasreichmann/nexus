import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        outDir: 'dist/standalone',
        emptyOutDir: true,
        minify: true,
        rollupOptions: {
            input: resolve(__dirname, 'src/standalone/app.tsx'),
            output: {
                entryFileNames: 'app.js',
                assetFileNames: 'app[extname]',
                // Single chunk, no code splitting
                manualChunks: undefined,
                inlineDynamicImports: true,
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
