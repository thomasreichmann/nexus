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

Always run `pnpm check` from the monorepo root to verify lint, build, and tests pass across all packages:

```bash
pnpm check
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

| File                                   | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `src/server/handler.ts`                | Next.js route handler (serves standalone UI) |
| `src/server/introspect.ts`             | Router → JSON Schema extraction              |
| `src/components/studio/`               | Main UI components                           |
| `src/standalone/app.tsx`               | Bundled React app (inlined in handler)       |
| `tsup.standalone.config.ts`            | Builds the standalone app (esbuild)          |
| `tsup.lib.config.ts`                   | Builds the library exports (esbuild)         |
| `build/embed-assets-esbuild-plugin.ts` | Inlines standalone assets into server.js     |

## Build Architecture

Uses tsup (esbuild) + Tailwind CLI. Two-stage build:

1. **Standalone** → Tailwind CLI compiles CSS, tsup bundles React app into `dist/standalone/app.{js,css}`
2. **Library** → tsup builds exports into `dist/index.js`, `dist/server.js` with embedded standalone assets

The standalone bundle gets inlined into HTML by the route handler via `embed-assets-esbuild-plugin`.

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

## GitHub Issues

All issues for this package MUST use the `trpc-devtools` label:

```bash
gh issue create --label "trpc-devtools,frontend,feature" --title "..."
```

## Documentation

- Package guide: `docs/guides/trpc-devtools.md`
- Planning doc: `docs/planning/trpc-studio.md`
- Publishing setup: `docs/decisions/npm-trusted-publishers.md`
