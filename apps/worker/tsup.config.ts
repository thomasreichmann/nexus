import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/handler.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    noExternal: [/.*/],
    banner: {
        // Bundled CJS dependencies (yazl, since #424) call require() for Node
        // builtins; esbuild's ESM output routes those through a __require stub
        // that throws "Dynamic require of X is not supported" unless a real
        // module-scope require exists for it to fall back on. Every invocation
        // of the deployed Lambda died at init the first time a CJS dep entered
        // the bundle — unit tests can't see this, they run the unbundled source
        // under vite's own interop.
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
});
