# CLAUDE.md - trpc-devtools

Package-specific instructions for working on `trpc-devtools`.

## Commands

Run from monorepo root using `-F` filter:

```bash
pnpm -F trpc-devtools dev        # Watch mode (rebuilds on changes)
pnpm -F trpc-devtools build      # Full build (standalone + library)
pnpm -F trpc-devtools test       # Run tests (add --run for single run)
pnpm -F trpc-devtools typecheck  # TypeScript check
```

## Before Committing

Always run build and tests:

```bash
pnpm -F trpc-devtools build && pnpm -F trpc-devtools test -- --run
```

## Publishing

Publishing is automated via GitHub Actions. Do NOT run `npm publish` manually.

**To release:**

1. Update `version` in `package.json`
2. Commit and push
3. Create and push tag:

```bash
git tag trpc-devtools@X.Y.Z
git push origin trpc-devtools@X.Y.Z
```

The workflow builds, tests, and publishes automatically using npm OIDC (no tokens needed).

## Key Files

| File                        | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `src/server/handler.ts`     | Next.js route handler (serves standalone UI) |
| `src/server/introspect.ts`  | Router → JSON Schema extraction              |
| `src/components/studio/`    | Main UI components                           |
| `src/standalone/app.tsx`    | Bundled React app (inlined in handler)       |
| `vite.standalone.config.ts` | Builds the standalone app                    |
| `vite.config.ts`            | Builds the library exports                   |

## Build Architecture

Two-stage build:

1. **Standalone** → Bundles React app into `dist/standalone/app.{js,css}`
2. **Library** → Builds exports into `dist/index.js`, `dist/server.js`

The standalone bundle gets inlined into HTML by the route handler.

## Patterns

### Router Introspection

Use tRPC v11 internals:

- `procedure._def.type` - query/mutation/subscription
- `procedure._def.inputs` - Zod validators
- `z.toJSONSchema()` - Native Zod v4 schema conversion

### CSS Scoping

All styles are scoped under `.trpc-studio` class. Use CSS variables for theming.

### Auth

Two mechanisms:

- `auth.headers` - Custom headers passed to client
- `auth.isAuthorized` - Server-side access control callback

## Testing Locally

Test in the Nexus app:

- Route handler: `http://localhost:3000/api/trpc-studio`
- Component: `http://localhost:3000/dev/studio`

## Documentation

- Package guide: `docs/guides/trpc-devtools.md`
- Planning doc: `docs/planning/trpc-studio.md`
- Publishing setup: `docs/decisions/npm-trusted-publishers.md`
