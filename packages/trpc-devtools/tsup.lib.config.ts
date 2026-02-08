import { defineConfig } from 'tsup';
import { embedAssetsPlugin } from './build/embed-assets-esbuild-plugin';
import { embedCssPlugin } from './build/embed-css-esbuild-plugin';

export default defineConfig({
    entry: { index: 'src/index.ts', server: 'src/server.ts' },
    format: ['esm'],
    outDir: 'dist',
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    dts: true,
    esbuildPlugins: [embedCssPlugin(), embedAssetsPlugin()],
    esbuildOptions(options) {
        options.jsx = 'automatic';
        options.alias = { '@': './src' };
    },
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
});
