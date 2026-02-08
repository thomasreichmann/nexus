import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

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
    entry: { 'standalone/app': 'src/standalone/app.tsx' },
    format: ['esm'],
    outDir: 'dist',
    clean: false,
    splitting: false,
    treeshake: true,
    minify: true,
    dts: false,
    esbuildPlugins: [ignoreCssPlugin()],
    esbuildOptions(options) {
        options.jsx = 'automatic';
        options.define = { 'process.env.NODE_ENV': '"production"' };
        options.alias = { '@': './src' };
    },
    noExternal: [/.*/], // Bundle everything including React
});
