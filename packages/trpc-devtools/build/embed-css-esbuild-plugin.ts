import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Plugin } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * esbuild plugin that intercepts CSS imports and replaces them with
 * runtime CSS injection code. The compiled CSS (from Tailwind CLI)
 * is embedded as a string constant in the JS bundle.
 *
 * At runtime, the CSS is injected into a <style> tag in <head> on
 * first import, with deduplication via a data attribute.
 */
export function embedCssPlugin(): Plugin {
    const cssPath = join(__dirname, '..', 'dist', 'styles.css');

    return {
        name: 'embed-css',
        setup(build) {
            build.onResolve({ filter: /\.css$/ }, () => ({
                path: 'embedded-css',
                namespace: 'embed-css',
            }));

            build.onLoad({ filter: /.*/, namespace: 'embed-css' }, () => {
                if (!existsSync(cssPath)) {
                    console.warn(
                        '[embed-css] dist/styles.css not found. Tailwind CLI must run before tsup.'
                    );
                    return {
                        contents: `
                            console.warn('trpc-devtools: CSS not embedded. Build may be incomplete.');
                        `,
                        loader: 'js',
                    };
                }

                const css = readFileSync(cssPath, 'utf-8');

                return {
                    contents: `
                        const STYLE_ID = 'trpc-devtools-styles';

                        if (typeof document !== 'undefined' && !document.querySelector('style[data-' + STYLE_ID + ']')) {
                            const style = document.createElement('style');
                            style.setAttribute('data-' + STYLE_ID, '');
                            style.textContent = ${JSON.stringify(css)};
                            document.head.appendChild(style);
                        }
                    `,
                    loader: 'js',
                };
            });
        },
    };
}
