import type { AnyRouter } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { introspectRouter } from './introspect';
import { getStandaloneJs, getStandaloneCss } from './assets';
import { THEME_KEY } from '../lib/storage';
import type { TRPCDevtoolsConfig, RouterSchema } from './types';

// Cache the introspected schema to avoid re-processing on every request
const schemaCache = new WeakMap<AnyRouter, RouterSchema>();

function getSchema<TRouter extends AnyRouter>(router: TRouter): RouterSchema {
    let schema = schemaCache.get(router);
    if (!schema) {
        schema = introspectRouter(router);
        schemaCache.set(router, schema);
    }
    return schema;
}

/**
 * Generate full HTML with inlined React app bundle
 */
function getDevtoolsHtml(config: {
    schemaUrl: string;
    trpcUrl: string;
    headers?: Record<string, string>;
}): string {
    // Escape closing script tags inside the bundle (e.g. react-dom contains
    // an innerHTML="<script></script>" string) so the HTML parser doesn't
    // terminate the inline <script> block early. "<\/script" is equivalent
    // inside JS string literals.
    const js = getStandaloneJs().replace(/<\/(script)/gi, '<\\/$1');
    const css = getStandaloneCss();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>tRPC Devtools</title>
    <script>
        // FOUC prevention: resolve the persisted theme before first paint.
        // The React app applies the theme class to the .trpc-devtools
        // wrapper itself; this only colors the page shell until hydration.
        (function () {
            var dark = true;
            try {
                var mode = localStorage.getItem(${JSON.stringify(THEME_KEY)});
                dark =
                    mode === 'dark' ||
                    (mode !== 'light' &&
                        window.matchMedia('(prefers-color-scheme: dark)')
                            .matches);
            } catch (e) {
                // Fall back to dark (previous hardcoded behavior)
            }
            document.documentElement.classList.add(dark ? 'dark' : 'light');
        })();
    </script>
    <style>html.dark { background-color: hsl(222 84% 5%); }</style>
    <style>${css}</style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.__TRPC_DEVTOOLS_CONFIG__ = ${JSON.stringify(config)};
    </script>
    <script type="module">${js}</script>
</body>
</html>`;
}

/**
 * Create a Next.js route handler for tRPC Devtools
 *
 * @example
 * ```typescript
 * // app/api/trpc-devtools/[[...devtools]]/route.ts
 * import { createTRPCDevtools } from 'trpc-devtools';
 * import { appRouter } from '@/server/routers';
 *
 * const handler = createTRPCDevtools({
 *     router: appRouter,
 *     url: '/api/trpc',
 * });
 *
 * export { handler as GET, handler as POST };
 * ```
 */
export function createTRPCDevtools<TRouter extends AnyRouter>(
    config: TRPCDevtoolsConfig<TRouter>
) {
    const { router, url, auth } = config;

    return async function handler(
        request: NextRequest,
        context: { params: Promise<{ devtools?: string[] }> }
    ): Promise<Response> {
        // Check authorization if configured
        if (auth?.isAuthorized) {
            const authorized = await auth.isAuthorized(request);
            if (!authorized) {
                return new Response('Unauthorized', { status: 401 });
            }
        }

        const params = await context.params;
        const path = params.devtools?.join('/') ?? '';

        // Determine base path from request URL
        const requestUrl = new URL(request.url);
        let basePath = config.basePath ?? requestUrl.pathname;

        // Remove trailing path segment if present
        if (path) {
            basePath = basePath.replace(new RegExp(`/${path}$`), '');
        }

        // Ensure basePath doesn't have trailing slash
        basePath = basePath.replace(/\/$/, '');

        // Route: /schema - return the introspected schema as JSON
        if (path === 'schema') {
            const schema = getSchema(router);
            return Response.json(schema, {
                headers: {
                    'Cache-Control': 'no-cache',
                },
            });
        }

        // Route: / or empty - serve the devtools UI
        if (path === '' || path === '/') {
            const html = getDevtoolsHtml({
                schemaUrl: `${basePath}/schema`,
                trpcUrl: url,
                headers: auth?.headers,
            });

            return new Response(html, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                },
            });
        }

        // Unknown route
        return new Response('Not Found', { status: 404 });
    };
}
