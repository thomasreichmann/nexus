# create-nexus-stack

> A CLI generator that scaffolds new Next.js applications mirroring the Nexus architecture, with optional BetterAuth, tRPC v11, and Drizzle.

## Vision

Enable developers to run `pnpm create nexus-stack my-app` and get a production-ready Next.js application with the same architecture, patterns, and tooling as Nexus—without the product-specific code.

**Why this exists:**

- Nexus has evolved into a solid, opinionated stack (Next.js 16, tRPC v11, Drizzle, BetterAuth)
- Setting up this stack from scratch is time-consuming and error-prone
- Existing starters (create-t3-app, etc.) don't match our architecture choices
- Keeping templates in sync with Nexus ensures they stay current

## Core Decisions

### Package Identity

| Aspect       | Decision                                                             |
| ------------ | -------------------------------------------------------------------- |
| Name         | `create-nexus-stack`                                                 |
| Scope        | Unscoped (enables `pnpm create nexus-stack`)                         |
| Location     | `packages/create-nexus-stack/`                                       |
| Relationship | Extracts templates from Nexus; Nexus is the reference implementation |

### Technical Stack

| Aspect         | Decision                 | Rationale                            |
| -------------- | ------------------------ | ------------------------------------ |
| **Prompts**    | clack (`@clack/prompts`) | Beautiful terminal UI, modern API    |
| **File ops**   | fs-extra                 | Reliable copy/write with Promise API |
| **Templating** | `{{VAR}}` replacement    | Simple, templates stay readable      |
| **CLI args**   | citty                    | Lightweight arg parsing              |
| **Bundler**    | tsup                     | Fast, zero-config for CLI tools      |
| **Testing**    | Vitest                   | Consistent with Nexus                |

### Feature Toggles

| Flag           | Feature                     | Dependencies                           |
| -------------- | --------------------------- | -------------------------------------- |
| `--db`         | Drizzle + Postgres          | None                                   |
| `--auth`       | BetterAuth                  | Implies `--db` (user/session tables)   |
| `--trpc`       | tRPC v11                    | None (auth-aware if `--auth` also set) |
| `--no-install` | Skip `pnpm install`         | None                                   |
| `-y` / `--yes` | Accept defaults (base only) | None                                   |

## CLI UX

### Interactive (default)

```
$ pnpm create nexus-stack my-app

┌  create-nexus-stack v1.0.0
│
◇  Project name: my-app
│
◆  Which features do you want?
│  ◻ Database (Drizzle + Postgres)
│  ◻ Authentication (BetterAuth)
│  ◻ API layer (tRPC v11)
│
◇  Installing dependencies...
│
└  Done! Next steps:

   cd my-app
   cp .env.example .env.local  # fill in values
   pnpm db:migrate             # if using db
   pnpm dev
```

### Non-interactive

```bash
pnpm create nexus-stack my-app --db --auth --trpc --no-install
```

## Package Structure

```
packages/create-nexus-stack/
├── src/
│   ├── index.ts              # CLI entry (bin)
│   ├── prompts.ts            # clack prompt flow
│   ├── scaffold.ts           # Copy templates + replace vars
│   ├── install.ts            # Optional pnpm install
│   └── utils.ts              # Helpers (validate name, etc.)
│
├── templates/
│   ├── base/                 # Always copied first
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── public/
│   │   ├── e2e/
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── ...
│   │
│   ├── with-db/              # Overlays when --db
│   │   ├── server/db/
│   │   ├── drizzle.config.ts
│   │   ├── package.json      # Merged deps
│   │   └── .env.example      # Appended
│   │
│   ├── with-auth/            # Overlays when --auth
│   │   ├── app/(auth)/
│   │   ├── app/api/auth/
│   │   ├── lib/auth/
│   │   ├── server/db/schema.ts  # Overwrites with user tables
│   │   ├── package.json
│   │   └── .env.example
│   │
│   └── with-trpc/            # Overlays when --trpc
│       ├── app/api/trpc/
│       ├── lib/trpc/
│       ├── server/trpc/
│       ├── package.json
│       └── .env.example
│
├── tests/
│   └── scaffold.test.ts      # Regression: generate combos, lint/typecheck
│
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Template Layering Strategy

Templates are overlaid in order; later layers can add files or overwrite earlier ones.

```
1. base/           (always)
2. with-db/        (if --db)
3. with-auth/      (if --auth, requires --db implicitly)
4. with-trpc/      (if --trpc)
```

### Merge Rules

| File Type      | Merge Behavior                     |
| -------------- | ---------------------------------- |
| Most files     | Later layer wins (full replace)    |
| `package.json` | Dependencies merged (not replaced) |
| `.env.example` | Appended per layer                 |

## Template Variables

Simple `{{VAR}}` syntax, replaced at scaffold time:

| Variable           | Source                | Example         |
| ------------------ | --------------------- | --------------- |
| `{{APP_NAME}}`     | CLI arg / prompt      | `my-app`        |
| `{{PACKAGE_NAME}}` | Derived from app name | `my-app`        |
| `{{DESCRIPTION}}`  | Prompt (optional)     | `A Next.js app` |

Used in:

- `package.json` → `name`, `description`
- `README.md` → title
- `app/layout.tsx` → metadata title

## File → Template Layer Mapping

### `base/` (always included)

| Source (Nexus `apps/web/`) | Template path       | Notes                        |
| -------------------------- | ------------------- | ---------------------------- |
| `app/layout.tsx`           | `app/layout.tsx`    | Root layout, no auth UI      |
| `app/page.tsx`             | `app/page.tsx`      | Minimal landing              |
| `app/globals.css`          | `app/globals.css`   | Tailwind base                |
| `components/ui/*`          | `components/ui/*`   | shadcn primitives            |
| `lib/cn.ts`                | `lib/cn.ts`         | Tailwind merge helper        |
| `lib/env/index.ts`         | `lib/env/index.ts`  | Env loader                   |
| `lib/env/schema.ts`        | `lib/env/schema.ts` | Base schema only             |
| Config files               | Config files        | eslint, next, tsconfig, etc. |
| `e2e/smoke/*`              | `e2e/smoke/*`       | Smoke tests                  |
| —                          | `package.json`      | Base deps only               |
| —                          | `.env.example`      | `NEXT_PUBLIC_APP_URL=`       |

### `with-db/` (if `--db`)

| Source                | Template path         | Notes                                   |
| --------------------- | --------------------- | --------------------------------------- |
| `server/db/index.ts`  | `server/db/index.ts`  | Drizzle client                          |
| `server/db/schema.ts` | `server/db/schema.ts` | Empty schema                            |
| `drizzle.config.ts`   | `drizzle.config.ts`   |                                         |
| —                     | `lib/env/schema.ts`   | Adds `DATABASE_URL`                     |
| —                     | `package.json`        | Adds drizzle-orm, drizzle-kit, postgres |
| —                     | `.env.example`        | `DATABASE_URL=`                         |

### `with-auth/` (if `--auth`, implies `--db`)

| Source                           | Template path                    | Notes                               |
| -------------------------------- | -------------------------------- | ----------------------------------- |
| `app/(auth)/layout.tsx`          | `app/(auth)/layout.tsx`          | Auth layout                         |
| `app/(auth)/login/page.tsx`      | `app/(auth)/login/page.tsx`      |                                     |
| `app/(auth)/signup/page.tsx`     | `app/(auth)/signup/page.tsx`     |                                     |
| `app/api/auth/[...all]/route.ts` | `app/api/auth/[...all]/route.ts` | BetterAuth handler                  |
| `lib/auth/client.ts`             | `lib/auth/client.ts`             |                                     |
| `lib/auth/server.ts`             | `lib/auth/server.ts`             |                                     |
| `server/db/schema.ts`            | `server/db/schema.ts`            | Overwrites with user/session tables |
| —                                | `lib/env/schema.ts`              | Adds `BETTER_AUTH_SECRET`           |
| —                                | `package.json`                   | Adds better-auth                    |
| —                                | `.env.example`                   | `BETTER_AUTH_SECRET=`               |

### `with-trpc/` (if `--trpc`)

| Source                           | Template path                    | Notes                                           |
| -------------------------------- | -------------------------------- | ----------------------------------------------- |
| `app/api/trpc/[trpc]/route.ts`   | `app/api/trpc/[trpc]/route.ts`   |                                                 |
| `lib/trpc/client.tsx`            | `lib/trpc/client.tsx`            | TRPCProvider                                    |
| `lib/trpc/query-client.ts`       | `lib/trpc/query-client.ts`       |                                                 |
| `server/trpc/init.ts`            | `server/trpc/init.ts`            |                                                 |
| `server/trpc/router.ts`          | `server/trpc/router.ts`          | Root router                                     |
| `server/trpc/routers/example.ts` | `server/trpc/routers/example.ts` | Example router                                  |
| —                                | `package.json`                   | Adds @trpc/\*, @tanstack/react-query, superjson |

## Dependency Matrix

### Runtime Dependencies

| Feature   | Dependencies                                                                              |
| --------- | ----------------------------------------------------------------------------------------- |
| **base**  | next, react, react-dom, clsx, tailwind-merge, class-variance-authority, lucide-react, zod |
| **+db**   | drizzle-orm, postgres, dotenv                                                             |
| **+auth** | better-auth                                                                               |
| **+trpc** | @trpc/server, @trpc/client, @trpc/tanstack-react-query, @tanstack/react-query, superjson  |

### Dev Dependencies

| Feature  | Dependencies                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **base** | typescript, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, vitest, @testing-library/react, @testing-library/jest-dom, jsdom, @vitejs/plugin-react, @playwright/test |
| **+db**  | drizzle-kit                                                                                                                                                                         |

## Build & Distribution

### tsup Configuration

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node18',
    clean: true,
    shims: true,
    banner: {
        js: '#!/usr/bin/env node',
    },
});
```

### Package Configuration

```json
{
    "name": "create-nexus-stack",
    "version": "0.1.0",
    "type": "module",
    "bin": {
        "create-nexus-stack": "./dist/index.js"
    },
    "files": ["dist", "templates"],
    "scripts": {
        "dev": "tsup --watch",
        "build": "tsup",
        "test": "vitest",
        "prepublishOnly": "pnpm build"
    },
    "dependencies": {
        "@clack/prompts": "^0.7.0",
        "citty": "^0.1.0",
        "fs-extra": "^11.0.0",
        "picocolors": "^1.0.0"
    },
    "devDependencies": {
        "@types/fs-extra": "^11.0.0",
        "@types/node": "^20.0.0",
        "tsup": "^8.0.0",
        "typescript": "^5.0.0",
        "vitest": "^2.0.0"
    }
}
```

## Development Workflow

### Integrated Development

Develop the CLI while testing against the Nexus codebase:

```bash
# packages/create-nexus-stack is linked automatically via pnpm workspaces

# Run the CLI locally
pnpm -F create-nexus-stack dev

# Test scaffolding to a temp directory
node packages/create-nexus-stack/dist/index.js /tmp/test-app --db --auth --trpc
```

### Testing Strategy

```typescript
// tests/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const combos = [
    { name: 'base', flags: '' },
    { name: 'db', flags: '--db' },
    { name: 'db-auth', flags: '--db --auth' },
    { name: 'trpc', flags: '--trpc' },
    { name: 'full', flags: '--db --auth --trpc' },
];

describe('scaffold', () => {
    combos.forEach(({ name, flags }) => {
        it(`generates valid ${name} app`, () => {
            const dir = mkdtempSync(join(tmpdir(), 'nexus-stack-'));
            try {
                execSync(`node dist/index.js ${dir}/app ${flags} --no-install`);
                execSync('pnpm install', { cwd: `${dir}/app` });
                execSync('pnpm lint', { cwd: `${dir}/app` });
                execSync('pnpm typecheck', { cwd: `${dir}/app` });
            } finally {
                rmSync(dir, { recursive: true });
            }
        });
    });
});
```

## Feature Roadmap

### Phase 1: Foundation

- [ ] Package scaffolding (tsup, TypeScript)
- [ ] CLI prompts with clack
- [ ] Basic scaffold engine (copy + variable replacement)
- [ ] `package.json` merge logic
- [ ] `.env.example` append logic

### Phase 2: Templates

- [ ] Audit Nexus `apps/web/` for template extraction
- [ ] Create `base/` template
- [ ] Create `with-db/` template
- [ ] Create `with-auth/` template
- [ ] Create `with-trpc/` template
- [ ] Remove Nexus-specific branding/code

### Phase 3: Polish

- [ ] Flag parsing (--db, --auth, --trpc, --no-install, -y)
- [ ] Dependency auto-enabling (--auth implies --db)
- [ ] Post-scaffold next-steps message
- [ ] README generation

### Phase 4: Validation

- [ ] Vitest regression suite for all combos
- [ ] CI workflow for testing
- [ ] Manual testing of generated apps

### Phase 5: Publish

- [ ] Check npm availability
- [ ] Set up NPM_TOKEN in GitHub secrets
- [ ] Publish workflow on tag
- [ ] Documentation

## Generated Output

### `.env.example` (full stack)

```bash
# Base
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Auth
BETTER_AUTH_SECRET=your-secret-min-32-chars
```

### Next Steps Message

```
Done! Next steps:

  cd my-app
  cp .env.example .env.local  # fill in values
  pnpm db:migrate             # if using db
  pnpm dev

Documentation: https://github.com/your-org/nexus
```

## Design Principles

1. **Mirror Nexus** - Generated apps should look exactly like Nexus (minus product code)
2. **Minimal prompts** - Get to a working app with minimal questions
3. **Sensible defaults** - Base template works out of the box
4. **Layered complexity** - Add features incrementally via flags
5. **Stay current** - Templates extracted from Nexus stay up to date

## Technical Notes

### Why Monorepo Location

- Templates can reference actual Nexus code during development
- Easier to keep templates in sync as Nexus evolves
- Shared tooling (Vitest, TypeScript config)
- Single PR can update both Nexus and templates

### Nexus-Specific Exclusions

These files are NOT included in templates:

- Product-specific pages (`app/(dashboard)/*`, etc.)
- Product-specific components (`sign-out-button.tsx`, etc.)
- S3/storage code (Nexus-specific feature)
- Product branding/assets

### Template Sync Strategy

When Nexus code changes:

1. Determine if change affects templates
2. Update relevant template layer
3. Run regression tests
4. Bump version if needed

## Future Enhancements (out of scope for MVP)

- **Monorepo mode**: `--monorepo` flag to scaffold Turborepo structure
- **Additional DBs**: `--db=mysql`, `--db=sqlite`
- **Additional auth**: `--auth=clerk`, `--auth=lucia`
- **Package manager choice**: `--pm=npm`, `--pm=yarn`
- **Git init**: `--git` to initialize git repo

## Open Questions (Resolved)

| Question           | Resolution                                           |
| ------------------ | ---------------------------------------------------- |
| Repo location      | Monorepo (`packages/create-nexus-stack/`)            |
| Package name       | `create-nexus-stack` (unscoped)                      |
| Bundler            | tsup                                                 |
| Nexus relationship | Extract templates; Nexus is reference implementation |
| E2E in base?       | Yes, Playwright included by default                  |

## References

- [create-t3-app](https://github.com/t3-oss/create-t3-app) - Similar generator, different stack
- [clack](https://github.com/natemoo-re/clack) - CLI prompts library
- [tsup](https://github.com/egoist/tsup) - TypeScript bundler
- [citty](https://github.com/unjs/citty) - CLI argument parser
