import type { AnyRouter } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { introspectRouter } from './introspect';
import { getStandaloneJs, getStandaloneCss } from './assets';
import type { TRPCStudioConfig, RouterSchema } from './types';

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
function getStudioHtml(config: {
    schemaUrl: string;
    trpcUrl: string;
    headers?: Record<string, string>;
}): string {
    const js = getStandaloneJs();
    const css = getStandaloneCss();

    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>tRPC Studio</title>
    <style>${css}</style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.__TRPC_STUDIO_CONFIG__ = ${JSON.stringify(config)};
    </script>
    <script type="module">${js}</script>
</body>
</html>`;
}

/**
 * Create a Next.js route handler for tRPC Studio
 *
 * @example
 * ```typescript
 * // app/api/trpc-studio/[[...studio]]/route.ts
 * import { createTRPCStudio } from 'trpc-devtools';
 * import { appRouter } from '@/server/routers';
 *
 * const handler = createTRPCStudio({
 *     router: appRouter,
 *     url: '/api/trpc',
 * });
 *
 * export { handler as GET, handler as POST };
 * ```
 */
export function createTRPCStudio<TRouter extends AnyRouter>(
    config: TRPCStudioConfig<TRouter>
) {
    const { router, url, auth } = config;

    return async function handler(
        request: NextRequest,
        context: { params: Promise<{ studio?: string[] }> }
    ): Promise<Response> {
        // Check authorization if configured
        if (auth?.isAuthorized) {
            const authorized = await auth.isAuthorized(request);
            if (!authorized) {
                return new Response('Unauthorized', { status: 401 });
            }
        }

        const params = await context.params;
        const path = params.studio?.join('/') ?? '';

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

        // Route: / or empty - serve the studio UI
        if (path === '' || path === '/') {
            const html = getStudioHtml({
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
