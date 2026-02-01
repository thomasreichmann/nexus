import type { AnyRouter } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { introspectRouter } from './introspect';
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
 * Minimal HTML template for the studio UI
 * In production, this would serve the pre-built React app
 */
function getStudioHtml(config: { schemaUrl: string; trpcUrl: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>tRPC Studio</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: ui-sans-serif, system-ui, sans-serif;
            background: #0a0a0a;
            color: #fafafa;
            min-height: 100vh;
        }
        #root {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 1;
            font-size: 1.125rem;
            color: #a1a1aa;
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading">Loading tRPC Studio...</div>
    </div>
    <script type="module">
        window.__TRPC_STUDIO_CONFIG__ = {
            schemaUrl: ${JSON.stringify(config.schemaUrl)},
            trpcUrl: ${JSON.stringify(config.trpcUrl)}
        };

        // The actual React app would be loaded here
        // For now, fetch and display the schema
        async function init() {
            try {
                const res = await fetch(window.__TRPC_STUDIO_CONFIG__.schemaUrl);
                const schema = await res.json();

                const root = document.getElementById('root');
                root.innerHTML = \`
                    <div style="padding: 2rem; max-width: 1200px; margin: 0 auto;">
                        <h1 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem;">
                            tRPC Studio
                        </h1>
                        <p style="color: #a1a1aa; margin-bottom: 2rem;">
                            Found \${schema.procedures.length} procedures
                        </p>
                        <div style="display: grid; gap: 0.5rem;">
                            \${schema.procedures.map(p => \`
                                <div style="
                                    background: #18181b;
                                    border: 1px solid #27272a;
                                    border-radius: 0.5rem;
                                    padding: 1rem;
                                    display: flex;
                                    align-items: center;
                                    gap: 0.75rem;
                                ">
                                    <span style="
                                        font-size: 0.75rem;
                                        font-weight: 500;
                                        padding: 0.25rem 0.5rem;
                                        border-radius: 0.25rem;
                                        background: \${p.type === 'query' ? '#1d4ed8' : p.type === 'mutation' ? '#15803d' : '#7c3aed'};
                                    ">
                                        \${p.type.toUpperCase()}
                                    </span>
                                    <code style="font-family: ui-monospace, monospace; font-size: 0.875rem;">
                                        \${p.path}
                                    </code>
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                \`;
            } catch (err) {
                console.error('Failed to load schema:', err);
                document.getElementById('root').innerHTML = \`
                    <div class="loading" style="color: #ef4444;">
                        Failed to load schema: \${err.message}
                    </div>
                \`;
            }
        }

        init();
    </script>
</body>
</html>`;
}

/**
 * Create a Next.js route handler for tRPC Studio
 *
 * @example
 * ```typescript
 * // app/api/trpc-studio/[[...studio]]/route.ts
 * import { createTRPCStudio } from '@nexus/trpc-studio';
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
    const { router, url } = config;

    return async function handler(
        request: NextRequest,
        context: { params: Promise<{ studio?: string[] }> }
    ): Promise<Response> {
        const params = await context.params;
        const path = params.studio?.join('/') ?? '';

        // Determine base path from request URL
        const requestUrl = new URL(request.url);
        const basePath =
            config.basePath ?? requestUrl.pathname.replace(`/${path}`, '');

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
