import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/handler.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    noExternal: [/.*/],
});
