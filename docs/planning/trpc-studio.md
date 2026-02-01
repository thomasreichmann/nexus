# @nexus/trpc-studio

> A modern developer tooling solution for tRPC APIs. More than just a Swagger UI - a full-fledged dev toolkit for tRPC developers.

## Vision

Build the definitive developer experience for tRPC APIs. Start with an API explorer that actually works with modern tRPC (v11) and Zod (v4), then expand into broader dev tooling.

**Why this exists:**

- [trpc-panel](https://github.com/iway1/trpc-panel) - abandoned 3+ years ago
- [trpc-ui](https://github.com/aidansunbury/trpc-ui) - broken with tRPC v11 and Zod v4
- No modern solution exists that leverages Zod v4's native `z.toJSONSchema()`

## Core Decisions

### Package Identity

| Aspect   | Decision                                |
| -------- | --------------------------------------- |
| Name     | `@nexus/trpc-studio`                    |
| Scope    | npm public registry                     |
| Location | `packages/trpc-studio/`                 |
| Vision   | Full dev tooling, not just API explorer |

### Technical Stack

| Aspect            | Decision                   | Rationale                               |
| ----------------- | -------------------------- | --------------------------------------- |
| **tRPC version**  | v11 only                   | No legacy support, clean implementation |
| **Zod version**   | v4 only                    | Use native `z.toJSONSchema()`           |
| **Frameworks**    | Next.js only (v1)          | Most common tRPC setup                  |
| **Bundler**       | Vite library mode          | Better CSS handling for Tailwind        |
| **UI components** | shadcn                     | Copy into package, pre-compile          |
| **Styling**       | Tailwind with `tp-` prefix | Scoped, no consumer config needed       |

### Integration Model

**Hybrid approach** - ship both a route handler and component library:

```typescript
// Option 1: Route handler (zero-config)
// app/api/trpc-studio/[[...studio]]/route.ts
import { createTRPCStudio } from '@nexus/trpc-studio';
import { appRouter } from '@/server/routers';

const handler = createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
});

export { handler as GET, handler as POST };
```

```tsx
// Option 2: Component library (full control)
// app/dev/studio/page.tsx
import { TRPCStudio } from '@nexus/trpc-studio';
import '@nexus/trpc-studio/styles.css';

export default function StudioPage() {
    return (
        <TRPCStudio schemaUrl="/api/trpc-studio/schema" trpcUrl="/api/trpc" />
    );
}
```

### Introspection Strategy

**Hybrid runtime + metadata approach:**

1. **Runtime introspection** (automatic)
    - Walk `router._def` to find procedures
    - Access `procedure._def.inputs` for Zod validators
    - Use `z.toJSONSchema()` for input schemas (native, stable)
    - Extract `procedure._def.type` (query/mutation/subscription)

2. **Metadata enhancement** (optional)
    - Support tRPC `.meta()` for descriptions, tags
    - Extract Zod `.describe()` for field-level docs
    - Show `.output()` schemas when defined

3. **Phase 2: Build-time extraction**
    - TypeScript compiler API for output types
    - Fallback when `.output()` not defined
    - Differentiating feature

### Authentication

**v1 Focus: BetterAuth integration + custom headers fallback**

```typescript
createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
    auth: {
        provider: 'better-auth',
        // Auto-detects session from cookies
    },
});

// Or custom headers
createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
    auth: {
        type: 'headers',
        headers: {
            Authorization: 'Bearer <token>',
        },
    },
});
```

### Request Execution

- **Direct from browser** to tRPC endpoint
- No proxy through studio backend
- SuperJSON auto-detection and handling
- Request/response history in localStorage

## Package Structure

```
packages/trpc-studio/
├── src/
│   ├── index.ts                    # Single entrypoint, tree-shakeable
│   │
│   ├── server/
│   │   ├── introspect.ts           # Router → JSON schema extraction
│   │   ├── handler.ts              # Next.js route handler
│   │   └── types.ts                # Server-side types
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn components (tp- prefixed)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── select.tsx
│   │   │   └── ...
│   │   │
│   │   ├── studio/                 # Studio-specific components
│   │   │   ├── studio.tsx          # Main studio component
│   │   │   ├── procedure-list.tsx  # Sidebar procedure tree
│   │   │   ├── procedure-view.tsx  # Individual procedure panel
│   │   │   ├── schema-form.tsx     # JSON Schema → form renderer
│   │   │   ├── response-viewer.tsx # Response display with JSON viewer
│   │   │   ├── request-history.tsx # History sidebar
│   │   │   └── auth-config.tsx     # Auth configuration panel
│   │   │
│   │   └── index.ts
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── better-auth.ts      # BetterAuth integration
│   │   │   └── headers.ts          # Custom headers auth
│   │   │
│   │   ├── schema/
│   │   │   ├── json-schema.ts      # JSON Schema utilities
│   │   │   └── form-generation.ts  # Schema → form field mapping
│   │   │
│   │   ├── request.ts              # tRPC request execution
│   │   ├── superjson.ts            # SuperJSON detection & handling
│   │   ├── storage.ts              # localStorage persistence
│   │   └── utils.ts                # Shared utilities
│   │
│   └── styles/
│       └── globals.css             # Tailwind base + CSS variables
│
├── package.json
├── vite.config.ts
├── tailwind.config.ts              # With tp- prefix
├── tsconfig.json
└── README.md
```

## Build & Distribution

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: 'index',
        },
        rollupOptions: {
            external: [
                'react',
                'react-dom',
                'next',
                '@trpc/server',
                '@trpc/client',
                'zod',
                'better-auth',
            ],
        },
    },
});
```

### Package Exports

```json
{
    "name": "@nexus/trpc-studio",
    "version": "0.1.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": {
            "import": "./dist/index.js",
            "types": "./dist/index.d.ts"
        },
        "./styles.css": "./dist/styles.css"
    },
    "files": ["dist"],
    "peerDependencies": {
        "@trpc/server": "^11.0.0",
        "next": "^14.0.0 || ^15.0.0 || ^16.0.0",
        "react": "^18.0.0 || ^19.0.0",
        "zod": "^3.24.0 || ^4.0.0"
    },
    "optionalDependencies": {
        "better-auth": "^1.0.0"
    }
}
```

### Tailwind Prefix Strategy

```typescript
// tailwind.config.ts
export default {
    prefix: 'tp-',
    content: ['./src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                // CSS variable-based theming
                primary: 'hsl(var(--tp-primary))',
                background: 'hsl(var(--tp-background))',
                // ...
            },
        },
    },
};
```

### Consumer Theming

```css
/* Consumer can override CSS variables */
:root {
    --tp-primary: 220 90% 56%;
    --tp-background: 0 0% 100%;
    --tp-foreground: 222 84% 5%;
}

.dark {
    --tp-background: 222 84% 5%;
    --tp-foreground: 210 40% 98%;
}
```

## Development Workflow

### Integrated Development

Develop the package while testing in the Nexus app:

```bash
# packages/trpc-studio is linked automatically via pnpm workspaces

# In apps/web, import directly:
import { TRPCStudio } from '@nexus/trpc-studio';

# Changes to packages/trpc-studio reflect immediately (Vite HMR)
```

### Scripts

```json
{
    "scripts": {
        "dev": "vite build --watch",
        "build": "vite build && tsc --emitDeclarationOnly",
        "typecheck": "tsc --noEmit",
        "lint": "eslint src/",
        "prepublishOnly": "pnpm build"
    }
}
```

### Turbo Integration

```json
// turbo.json (updated)
{
    "tasks": {
        "build": {
            "dependsOn": ["^build"],
            "outputs": [".next/**", "dist/**"]
        }
    }
}
```

## Feature Roadmap

### Phase 1: MVP

- [ ] Package scaffolding (Vite, Tailwind, shadcn)
- [ ] Router introspection with `z.toJSONSchema()`
- [ ] Basic UI: procedure list, input form, response viewer
- [ ] Request execution (direct fetch)
- [ ] SuperJSON auto-detection
- [ ] Custom headers authentication
- [ ] Request history (localStorage)
- [ ] Route handler for zero-config setup
- [ ] Dark/light mode

### Phase 2: Auth & Polish

- [ ] BetterAuth integration
- [ ] Output schema display (when `.output()` defined)
- [ ] Improved form generation (better type handling)
- [ ] Request collections (saved requests)
- [ ] Copy as cURL/fetch
- [ ] Keyboard shortcuts

### Phase 3: Differentiators

- [ ] Build-time output type extraction (TypeScript compiler)
- [ ] Procedure search
- [ ] Request diff viewer
- [ ] Performance timing display
- [ ] Export/import collections

### Phase 4: Expansion

- [ ] Subscription support (WebSocket)
- [ ] Additional auth providers
- [ ] Framework support beyond Next.js
- [ ] VS Code extension
- [ ] CLI tool

## Design Principles

1. **Zero-config by default** - Works with one line of code
2. **Progressive enhancement** - Add metadata for richer docs
3. **Modern only** - No legacy support, leverage latest features
4. **Dev-first** - Optimized for development, not production
5. **Non-invasive** - Doesn't require changes to existing tRPC setup

## Technical Notes

### Why Zod v4 Native `z.toJSONSchema()`

Previous tools (trpc-ui, trpc-panel) parsed Zod internals:

- Accessed `_def.typeName` (removed in Zod v4)
- Used `zod-to-json-schema` library (incompatible with Zod v4)
- Broke with every Zod update

Zod v4 provides `z.toJSONSchema()` natively:

- Officially supported, won't break
- Handles all type conversions
- No internal parsing needed

### tRPC v11 Internals We Rely On

```typescript
// These are relatively stable
procedure._def.type; // 'query' | 'mutation' | 'subscription'
procedure._def.inputs; // Zod validator array
procedure._def.meta; // User-defined metadata
router._def.router; // true (identifies routers)
```

### SuperJSON Detection

```typescript
// Check if response contains SuperJSON metadata
function detectSuperJSON(response: unknown): boolean {
    return (
        typeof response === 'object' &&
        response !== null &&
        'json' in response &&
        'meta' in response
    );
}
```

## Open Questions (Resolved)

| Question          | Resolution                        |
| ----------------- | --------------------------------- |
| Package scope     | `@nexus/` scope, npm public       |
| Zod version       | v4 only                           |
| tRPC version      | v11 only                          |
| Framework support | Next.js only (v1)                 |
| Auth approach     | BetterAuth + custom headers       |
| Subscriptions     | Defer to Phase 4                  |
| Output types      | Phase 3 (build-time extraction)   |
| Bundler           | Vite library mode                 |
| CSS strategy      | Pre-compiled Tailwind with prefix |
| Persistence       | localStorage                      |
| Request flow      | Direct from browser               |

## References

- [trpc-ui](https://github.com/aidansunbury/trpc-ui) - Current best option (but broken with v11/Zod v4)
- [trpc-panel](https://github.com/iway1/trpc-panel) - Original, abandoned
- [trpc-openapi](https://github.com/trpc/trpc-openapi) - OpenAPI generation approach
- [openapi-trpc](https://github.com/dtinth/openapi-trpc) - Alternative OpenAPI approach
- [Zod JSON Schema docs](https://zod.dev/json-schema) - Native toJSONSchema
- [tRPC v11 migration](https://trpc.io/docs/migrate-from-v10-to-v11) - Breaking changes
