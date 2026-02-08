import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Plugin } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * esbuild plugin that embeds the standalone bundle assets into the server build
 * at build time, eliminating the need for runtime file system access.
 */
export function embedAssetsPlugin(): Plugin {
    const distStandalone = join(__dirname, '..', 'dist', 'standalone');

    return {
        name: 'embed-standalone-assets',
        setup(build) {
            build.onLoad({ filter: /server\/assets\.ts$/ }, (args) => {
                const jsPath = join(distStandalone, 'app.js');
                const cssPath = join(distStandalone, 'app.css');

                if (!existsSync(jsPath) || !existsSync(cssPath)) {
                    console.warn(
                        '[embed-assets] Standalone assets not found. Run build:standalone first.'
                    );
                    // Return placeholder that will error at runtime with a helpful message
                    return {
                        contents: `
                            export function getStandaloneJs() {
                                throw new Error('Standalone assets not found. Build order: build:standalone must run before build:lib');
                            }
                            export function getStandaloneCss() {
                                throw new Error('Standalone assets not found. Build order: build:standalone must run before build:lib');
                            }
                        `,
                        loader: 'ts',
                    };
                }

                const js = readFileSync(jsPath, 'utf-8');
                const css = readFileSync(cssPath, 'utf-8');

                // Replace the entire module with embedded constants
                return {
                    contents: `
                        const EMBEDDED_JS = ${JSON.stringify(js)};
                        const EMBEDDED_CSS = ${JSON.stringify(css)};

                        export function getStandaloneJs() {
                            return EMBEDDED_JS;
                        }

                        export function getStandaloneCss() {
                            return EMBEDDED_CSS;
                        }
                    `,
                    loader: 'ts',
                };
            });
        },
    };
}
