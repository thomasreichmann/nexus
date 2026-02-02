import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';
import { embedAssetsPlugin } from './build/embed-assets-esbuild-plugin';

// Plugin to ignore CSS imports (handled by Tailwind CLI)
function ignoreCssPlugin(): Plugin {
    return {
        name: 'ignore-css',
        setup(build) {
            build.onResolve({ filter: /\.css$/ }, () => ({
                path: 'ignored',
                namespace: 'ignore-css',
            }));
            build.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({
                contents: '',
                loader: 'js',
            }));
        },
    };
}

export default defineConfig({
    entry: { index: 'src/index.ts', server: 'src/server.ts' },
    format: ['esm'],
    outDir: 'dist',
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    dts: true,
    esbuildPlugins: [ignoreCssPlugin(), embedAssetsPlugin()],
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
