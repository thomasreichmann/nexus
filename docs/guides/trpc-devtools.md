# trpc-devtools Package Guide

> Maintainer and contributor documentation for the `trpc-devtools` npm package.

**npm:** https://www.npmjs.com/package/trpc-devtools
**Source:** `packages/trpc-studio/`
**Planning doc:** [[../planning/trpc-studio|trpc-studio planning]]

## Overview

`trpc-devtools` is a developer tooling solution for tRPC APIs, published as a public npm package. It fills a gap in the tRPC ecosystem left by abandoned/broken alternatives (trpc-panel, trpc-ui).

### Why It Exists

- **trpc-panel** - Abandoned 3+ years ago
- **trpc-ui** - Broken with tRPC v11 and Zod v4
- No modern solution leverages Zod v4's native `z.toJSONSchema()`

### Key Features

- Router introspection using Zod v4's native JSON Schema support
- Zero-config setup via route handler
- Component library for custom integrations
- Request execution with SuperJSON auto-detection
- Request history persistence (localStorage)
- Dark/light mode support

## Development Setup

### Prerequisites

- pnpm 10+
- Node.js 22+ (24+ for publishing)

### Local Development

```bash
# From monorepo root
pnpm install

# Watch mode - rebuilds on changes
pnpm -F trpc-devtools dev

# Build
pnpm -F trpc-devtools build

# Run tests
pnpm -F trpc-devtools test

# Typecheck
pnpm -F trpc-devtools typecheck
```

### Testing in the Nexus App

The package is linked via pnpm workspaces. Changes reflect immediately:

```typescript
// apps/web/app/api/trpc-studio/[[...studio]]/route.ts
import { createTRPCStudio } from 'trpc-devtools/server';

// apps/web/app/dev/studio/page.tsx
import { TRPCStudio } from 'trpc-devtools';
```

Visit `http://localhost:3000/api/trpc-studio` to test the route handler.
Visit `http://localhost:3000/dev/studio` to test the component library.

## Publishing

Publishing is fully automated via GitHub Actions using npm's OIDC trusted publishers (no tokens required).

### To Release a New Version

1. **Update version** in `packages/trpc-studio/package.json`
2. **Commit and push** the change
3. **Create and push a tag:**

```bash
git tag trpc-devtools@X.Y.Z
git push origin trpc-devtools@X.Y.Z
```

The workflow at `.github/workflows/publish-trpc-devtools.yml` will:

- Install dependencies
- Build the package
- Run tests
- Publish to npm with provenance attestation

### Versioning

Follow semver:

- **Patch** (0.1.x): Bug fixes, minor improvements
- **Minor** (0.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

### Troubleshooting Publishing

If the workflow fails, check:

1. Version in package.json matches the tag
2. Tag format is exactly `trpc-devtools@X.Y.Z`
3. npm trusted publisher is configured (see [[../decisions/npm-trusted-publishers|npm-trusted-publishers]])

## Architecture

### Package Structure

```
packages/trpc-studio/
├── src/
│   ├── index.ts              # Client entrypoint (React components)
│   ├── server.ts             # Server entrypoint (Node.js only)
│   ├── client.ts             # Re-exports for client
│   │
│   ├── server/
│   │   ├── handler.ts        # Next.js route handler
│   │   ├── introspect.ts     # Router → JSON Schema extraction
│   │   ├── assets.ts         # Bundled standalone app
│   │   └── types.ts          # Shared type definitions
│   │
│   ├── components/
│   │   ├── studio/           # Main studio components
│   │   └── ui/               # shadcn-based UI components
│   │
│   ├── lib/
│   │   ├── request.ts        # tRPC request execution
│   │   ├── superjson.ts      # SuperJSON detection
│   │   ├── storage.ts        # localStorage persistence
│   │   └── utils.ts          # Shared utilities (cn, etc.)
│   │
│   ├── standalone/
│   │   └── app.tsx           # Standalone React app (bundled into handler)
│   │
│   └── styles/
│       └── globals.css       # Tailwind + CSS variables
│
├── vite.config.ts            # Library build config
├── vite.standalone.config.ts # Standalone app build config
└── package.json
```

### Build Process

Two-stage build:

1. **Standalone build** (`vite.standalone.config.ts`)
    - Bundles the React app into a single JS + CSS file
    - Output: `dist/standalone/app.{js,css}`
    - These get inlined into the HTML served by the route handler

2. **Library build** (`vite.config.ts`)
    - Builds the component library and server exports
    - External: react, react-dom, next, @trpc/server, zod
    - Output: `dist/index.js`, `dist/server.js`, `dist/styles.css`

### Entry Points

```json
{
    "exports": {
        ".": "./dist/index.js", // React components
        "./server": "./dist/server.js", // Node.js route handler
        "./styles.css": "./dist/styles.css"
    }
}
```

## Key Patterns

### Router Introspection

Uses tRPC v11 internals (relatively stable):

```typescript
procedure._def.type; // 'query' | 'mutation' | 'subscription'
procedure._def.inputs; // Zod validator array
procedure._def.meta; // User metadata
router._def.router; // true (identifies routers)
```

Schema extraction uses Zod v4's native `z.toJSONSchema()` - no third-party parsers.

### Auth Configuration

Two auth mechanisms:

1. **Custom headers** - Passed to client for API requests
2. **isAuthorized callback** - Server-side access control

```typescript
createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
    auth: {
        headers: { 'X-API-Key': '...' },
        isAuthorized: async (req) => {
            const session = await auth.api.getSession({ headers: req.headers });
            return session?.user?.role === 'admin';
        },
    },
});
```

### CSS Scoping

All Tailwind classes use the `.trpc-studio` scope to prevent conflicts with consumer apps. CSS variables allow theming:

```css
.trpc-studio {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    /* ... */
}
```

## Testing

```bash
# Run tests
pnpm -F trpc-devtools test

# Watch mode
pnpm -F trpc-devtools test -- --watch

# Run specific test file
pnpm -F trpc-devtools test -- src/server/introspect.test.ts
```

### Test Coverage

- `src/server/introspect.test.ts` - Router introspection
- `src/lib/utils.test.ts` - Utility functions

## Decisions

| Decision                     | Rationale                                  |
| ---------------------------- | ------------------------------------------ |
| **tRPC v11 only**            | Clean implementation, no legacy baggage    |
| **Zod v4 only**              | Native `z.toJSONSchema()` support          |
| **Next.js only (v1)**        | Most common tRPC setup                     |
| **Vite for bundling**        | Better CSS handling for Tailwind           |
| **No Tailwind prefix**       | Using `.trpc-studio` scope wrapper instead |
| **Direct browser requests**  | No proxy through studio backend            |
| **localStorage for history** | Simple, no server state needed             |

## Roadmap

See [[../planning/trpc-studio#Feature Roadmap|planning doc roadmap]] for full details.

**Completed (Phase 1):**

- Router introspection
- Basic UI (procedure list, form, response viewer)
- Request execution with SuperJSON
- Request history
- Route handler
- Custom headers auth
- Dark mode

**Next (Phase 2):**

- Output schema display
- Improved form generation
- Request collections
- Copy as cURL/fetch

## Contributing

1. Create an issue describing the change
2. Fork and create a feature branch
3. Make changes with tests
4. Run `pnpm -F trpc-devtools build && pnpm -F trpc-devtools test`
5. Submit PR referencing the issue

## References

- [npm package](https://www.npmjs.com/package/trpc-devtools)
- [Zod JSON Schema docs](https://zod.dev/json-schema)
- [tRPC v11 docs](https://trpc.io/docs)
- [[../planning/trpc-studio|Planning document]]
- [[../decisions/npm-trusted-publishers|npm trusted publishers decision]]
