# @nexus/trpc-studio

A modern developer tooling solution for tRPC APIs. More than just a Swagger UI - a full-fledged dev toolkit for tRPC developers.

## Features

- **Router Introspection**: Automatically extracts procedure schemas using Zod v4's native `z.toJSONSchema()`
- **Zero-Config Setup**: Works with a single line of code via route handler
- **Component Library**: Use as a standalone component for full control
- **Request Execution**: Execute tRPC procedures directly from the browser
- **Request History**: Persists request/response history in localStorage
- **SuperJSON Support**: Auto-detects and handles SuperJSON responses
- **Dark Mode**: Built-in light and dark theme support

## Requirements

- tRPC v11
- Zod v4
- Next.js 14, 15, or 16
- React 18 or 19

## Installation

```bash
pnpm add @nexus/trpc-studio
```

## Usage

### Option 1: Route Handler (Zero-Config)

```typescript
// app/api/trpc-studio/[[...studio]]/route.ts
import { createTRPCStudio } from '@nexus/trpc-studio/server';
import { appRouter } from '@/server/routers';

const handler = createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
});

export { handler as GET, handler as POST };
```

Then visit `/api/trpc-studio` to view the full studio UI.

### Option 2: Component Library (Full Control)

```tsx
// app/dev/studio/page.tsx
import { TRPCStudio } from '@nexus/trpc-studio';
import '@nexus/trpc-studio/styles.css';

export default function StudioPage() {
    return (
        <TRPCStudio schemaUrl="/api/trpc-studio/schema" trpcUrl="/api/trpc" />
    );
}
```

## API Reference

### Imports

```typescript
// Server-side (Node.js only)
import { createTRPCStudio, introspectRouter } from '@nexus/trpc-studio/server';

// Client-side (React components)
import { TRPCStudio } from '@nexus/trpc-studio';
import '@nexus/trpc-studio/styles.css';
```

### `createTRPCStudio(config)`

Creates a Next.js route handler for the studio.

```typescript
interface TRPCStudioConfig {
    router: AnyRouter; // Your tRPC router
    url: string; // URL of your tRPC endpoint
    auth?: AuthConfig; // Optional auth configuration
    basePath?: string; // Optional base path override
}

interface AuthConfig {
    headers?: Record<string, string>; // Headers for tRPC requests
    isAuthorized?: (req: Request) => boolean | Promise<boolean>;
}
```

#### Authentication Examples

**Restrict access to admins (BetterAuth):**

```typescript
const handler = createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
    auth: {
        isAuthorized: async (req) => {
            const session = await auth.api.getSession({ headers: req.headers });
            return session?.user?.role === 'admin';
        },
    },
});
```

**API key authentication:**

```typescript
const handler = createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
    auth: {
        headers: {
            'X-API-Key': process.env.INTERNAL_API_KEY!,
        },
    },
});
```

### `<TRPCStudio />`

React component for the studio UI.

```typescript
interface TRPCStudioProps {
    schemaUrl: string; // URL to fetch the schema
    trpcUrl: string; // URL of the tRPC endpoint
    headers?: Record<string, string>; // Custom headers
    className?: string; // Additional CSS classes
}
```

### `introspectRouter(router)`

Introspect a router and extract procedure schemas.

```typescript
import { introspectRouter } from '@nexus/trpc-studio/server';

const schema = introspectRouter(appRouter);
// Returns: { procedures: [...], version: 1, generatedAt: '...' }
```

## Theming

The studio uses CSS custom properties for theming. Override in your CSS:

```css
:root {
    --color-primary: hsl(220 90% 56%);
    --color-background: hsl(0 0% 100%);
    /* ... */
}

.dark {
    --color-background: hsl(222 84% 5%);
    /* ... */
}
```

## Development

```bash
# Watch mode
pnpm -F @nexus/trpc-studio dev

# Build
pnpm -F @nexus/trpc-studio build

# Typecheck
pnpm -F @nexus/trpc-studio typecheck
```

## License

MIT
