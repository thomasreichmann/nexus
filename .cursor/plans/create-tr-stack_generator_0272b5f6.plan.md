---
name: create-tr-stack Generator
overview: Build a decoupled npm-distributed create-* CLI named `create-tr-stack` that scaffolds a new Next.js app folder mirroring the current Nexus structure, with optional BetterAuth, tRPC v11, and Drizzle. Nexus remains the reference implementation; it is not converted into a generated instance.
todos:
  - id: boundary-audit
    content: Audit `apps/web` and classify reusable baseline vs Nexus-specific pieces; produce file→template layer mapping.
    status: pending
  - id: generator-repo
    content: Create standalone repo with `create-tr-stack` package skeleton (tsup build, bin entry, clack prompts stub).
    status: pending
    dependencies:
      - boundary-audit
  - id: cli-core
    content: Implement CLI prompts + flags + copy/replace engine using clack + fs-extra; wire up --auth/--trpc/--db/--no-install.
    status: pending
    dependencies:
      - generator-repo
  - id: extract-templates
    content: Extract `base`, `with-auth`, `with-trpc`, `with-db` from Nexus; remove Nexus branding; add {{VAR}} placeholders.
    status: pending
    dependencies:
      - cli-core
  - id: validate-output
    content: Add Vitest regression suite that scaffolds preset combos into temp dirs and runs lint + typecheck in each.
    status: pending
    dependencies:
      - extract-templates
  - id: publish
    content: Publish to npm as `create-tr-stack`; set up GitHub Actions for CI + npm publish on tag.
    status: pending
    dependencies:
      - validate-output
---

# `create-tr-stack` (decoupled Nexus-style starter)

## Goal

Create a reusable starter generator so you can run `pnpm create tr-stack <app-name>` to scaffold a **brand-new folder** (new repo) that looks like Nexus does today—minus the product-specific code.

## Constraints / Decisions (locked in)

| Decision | Choice|

|----------|--------|

|Nexus relationship | Extract templates from Nexus; Nexus itself is **not** generated|

|Distribution | npm create-* package|

|Package name | `create-tr-stack` (fallback: `@tr-stack/create` if taken)|

|Output | New directory, user initializes git|

|Feature toggles | `--auth` (BetterAuth), `--trpc` (tRPC v11), `--db` (Drizzle + Postgres)|

|E2E in base? | **Yes** — Playwright included by default|---

## Tech Stack for the Generator

| Concern | Choice | Rationale|

|---------|--------|-----------|

|Prompts | **clack** (`@clack/prompts`) | Beautiful terminal UI, modern API, small|

|File ops | **fs-extra** | Reliable copy/write with Promise API|

|Templating | Simple `{{VAR}}` replacement | No need for full EJS/Handlebars; keeps templates readable|

|CLI args | **citty** or **commander** | Lightweight arg parsing|

|Build | **tsup** | Fast TS → ESM/CJS bundler with zero config|

|Testing | **Vitest** | Fast, modern, same as Nexus|---

## Generator Repo Structure

A single-package repo (no monorepo overhead for a CLI):

```text
create-tr-stack/
├── src/
│   ├── index.ts           # CLI entry (bin)
│   ├── prompts.ts         # clack prompt flow
│   ├── scaffold.ts        # copy templates + replace vars
│   ├── install.ts         # optional pnpm install
│   └── utils.ts           # helpers (validate name, etc.)
├── templates/
│   ├── base/              # always copied first
│   ├── with-auth/         # overlays when --auth
│   ├── with-trpc/         # overlays when --trpc
│   └── with-db/           # overlays when --db
├── tests/
│   └── scaffold.test.ts   # regression: generate combos, lint/typecheck
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── LICENSE

```

---

## Template Layering Strategy

Templates are **overlaid** in order; later layers can add files or overwrite earlier ones.

```javascript
1. base/           (always)
2. with-db/        (if --db)
3. with-auth/      (if --auth, requires --db implicitly for user table)
4. with-trpc/      (if --trpc)

```

**Merge rules:**

- Files are copied by path; if a file exists in multiple layers, the later layer wins (full replace, not merge).
- `package.json` is **special**: dependencies from each layer are merged (not replaced).
- `.env.example` is **appended** per layer.

---

## File → Template Layer Mapping

### `base/` (always included)

| Source (Nexus `apps/web/`) | Template path | Notes|

|---------------------------|---------------|-------|

|`app/layout.tsx` | `app/layout.tsx` | Root layout, no auth UI|

|`app/page.tsx` | `app/page.tsx` | Minimal landing|

|`app/globals.css` | `app/globals.css` | Tailwind base|

|`app/favicon.ico` | `app/favicon.ico` |

|`components/ui/*` | `components/ui/*` | shadcn primitives|

|`lib/cn.ts` | `lib/cn.ts` | Tailwind merge helper|

|`lib/env/index.ts` | `lib/env/index.ts` | Env loader (schema varies by layer)|

|`lib/env/schema.ts` | `lib/env/schema.ts` | **Base schema only** (APP_URL)|

|`eslint.config.mjs` | `eslint.config.mjs` |

|`next.config.ts` | `next.config.ts` |

|`tsconfig.json` | `tsconfig.json` |

|`postcss.config.mjs` | `postcss.config.mjs` |

|`vitest.config.ts` | `vitest.config.ts` |

|`vitest.setup.ts` | `vitest.setup.ts` |

|`playwright.config.ts` | `playwright.config.ts` |

|`e2e/home.spec.ts` | `e2e/home.spec.ts` | Smoke test|

|`public/*` | `public/*` | Static assets|

|— | `package.json` | **Base deps only**|

|— | `.env.example` | `NEXT_PUBLIC_APP_URL=`|

|— | `README.md` | Generated project readme |

### `with-db/` (if `--db`)

| Source | Template path | Notes|

|--------|---------------|-------|

|`server/db/index.ts` | `server/db/index.ts` | Drizzle client|

|`server/db/schema.ts` | `server/db/schema.ts` | Empty schema (no user table yet)|

|`drizzle.config.ts` | `drizzle.config.ts` |

|— | `lib/env/schema.ts` | Adds `DATABASE_URL`|

|— | `package.json` | Adds `drizzle-orm`, `drizzle-kit`, `postgres`|

|— | `.env.example` | `DATABASE_URL=` |

### `with-auth/` (if `--auth`, implies `--db`)

| Source | Template path | Notes|

|--------|---------------|-------|

|`app/(auth)/layout.tsx` | `app/(auth)/layout.tsx` | Auth layout|

|`app/(auth)/login/page.tsx` | `app/(auth)/login/page.tsx` |

|`app/(auth)/signup/page.tsx` | `app/(auth)/signup/page.tsx` |

|`app/api/auth/[...all]/route.ts` | `app/api/auth/[...all]/route.ts` | BetterAuth handler|

|`lib/auth/client.ts` | `lib/auth/client.ts` |

|`lib/auth/server.ts` | `lib/auth/server.ts` |

|`server/db/schema.ts` | `server/db/schema.ts` | **Overwrites** with user/session tables|

|— | `lib/env/schema.ts` | Adds `BETTER_AUTH_SECRET`|

|— | `package.json` | Adds `better-auth`|

|— | `.env.example` | `BETTER_AUTH_SECRET=` |

### `with-trpc/` (if `--trpc`)

| Source | Template path | Notes|

|--------|---------------|-------|

|`app/api/trpc/[trpc]/route.ts` | `app/api/trpc/[trpc]/route.ts` |

|`lib/trpc/client.tsx` | `lib/trpc/client.tsx` | TRPCProvider|

|`lib/trpc/query-client.ts` | `lib/trpc/query-client.ts` |

|`server/trpc/init.ts` | `server/trpc/init.ts` |

|`server/trpc/router.ts` | `server/trpc/router.ts` | Root router|

|`server/trpc/routers/debug.ts` | `server/trpc/routers/debug.ts` | Example router|

|(if auth) `server/trpc/routers/auth.ts` | `server/trpc/routers/auth.ts` | Auth-aware procedures|

|— | `package.json` | Adds `@trpc/*`, `@tanstack/react-query`, `superjson`|---

## Dependency Matrix

| Feature | Runtime deps | Dev deps|

|---------|--------------|----------|

|**base** | `next`, `react`, `react-dom`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `zod` | `typescript`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`, `@playwright/test`|

|**+db** | `drizzle-orm`, `postgres`, `dotenv` | `drizzle-kit`|

|**+auth** | `better-auth` | —|

|**+trpc** | `@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`, `@tanstack/react-query`, `superjson` | —|---

## Template Variables

Simple `{{VAR}}` syntax, replaced at scaffold time:| Variable | Source | Example|

|----------|--------|---------|

|`{{APP_NAME}}` | CLI arg / prompt | `my-app`|

|`{{PACKAGE_NAME}}` | Derived from app name | `my-app` or `@scope/my-app`|

|`{{DESCRIPTION}}` | Prompt (optional) | `A Next.js app`|Used in:

- `package.json` → `name`, `description`
- `README.md` → title
- `app/layout.tsx` → metadata title

---

## CLI UX

### Interactive (default)

```text
$ pnpm create tr-stack my-app

┌  create-tr-stack v1.0.0
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
pnpm create tr-stack my-app --db --auth --trpc --no-install

```

| Flag | Effect|

|------|--------|

|`--db` | Include Drizzle + Postgres|

|`--auth` | Include BetterAuth (implies `--db`)|

|`--trpc` | Include tRPC v11|

|`--no-install` | Skip `pnpm install`|

|`--yes` / `-y` | Accept defaults (base only)|---

## Feature Interdependencies

```javascript
--auth  →  requires --db (user/session tables need database)
--trpc  →  standalone (but auth-aware procedures included if --auth also set)
--db    →  standalone

```

If user passes `--auth` without `--db`, CLI auto-enables `--db` with a note.---

## Generated `.env.example`

Built up per layer:

```bash
# Base
NEXT_PUBLIC_APP_URL=http://localhost:3000

# +db
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# +auth
BETTER_AUTH_SECRET=your-secret-min-32-chars

```

---

## Validation / Regression Testing

In the generator repo, a Vitest suite that:

1. Scaffolds each combo into a temp directory:

    - `base`
    - `base + db`
    - `base + db + auth`
    - `base + trpc`
    - `base + db + auth + trpc` (full stack)

2. Runs in each:

    - `pnpm install`
    - `pnpm lint`
    - `pnpm typecheck`

3. Asserts all exit 0.

This ensures templates stay valid as Nexus evolves.---

## CI/CD (GitHub Actions)

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
    - run: pnpm install
    - run: pnpm test
    - run: pnpm build

# .github/workflows/publish.yml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: https://registry.npmjs.org }
    - run: pnpm install
    - run: pnpm build
    - run: pnpm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

```

---

## Versioning Strategy

- Generator version is independent of Nexus version.
- Use **SemVer**: breaking template changes = major bump.
- Tag releases: `v1.0.0`, `v1.1.0`, etc.
- No changesets needed for a single-package repo; manual version bumps are fine.

---

## Implementation Checklist

### Phase 1: Audit (`boundary-audit`)

- [ ] Walk through `apps/web/` and tag each file as `base`, `auth`, `trpc`, `db`, or `nexus-specific`
- [ ] Document Nexus-specific files to **exclude** (e.g., `sign-out-button.tsx`, `user-info-client.tsx`, product pages)
- [ ] Produce the file→template mapping table (draft above)
- [ ] Identify any shared code that needs deduplication

### Phase 2: Scaffold Generator Repo (`generator-repo`)

- [ ] `mkdir create-tr-stack && cd create-tr-stack && pnpm init`
- [ ] Add deps: `clack`, `fs-extra`, `citty`, `picocolors`
- [ ] Add dev deps: `tsup`, `typescript`, `vitest`, `@types/fs-extra`, `@types/node`
- [ ] Set up `tsup.config.ts` for ESM output with shebang
- [ ] Add `bin` entry in `package.json`
- [ ] Create `src/index.ts` with basic clack intro

### Phase 3: CLI Core (`cli-core`)

- [ ] Implement prompt flow in `src/prompts.ts`
- [ ] Implement `src/scaffold.ts`: copy templates, merge `package.json`, append `.env.example`
- [ ] Implement `src/install.ts`: run `pnpm install` via `execa`
- [ ] Wire up flags: `--db`, `--auth`, `--trpc`, `--no-install`, `-y`
- [ ] Print next-steps message

### Phase 4: Extract Templates (`extract-templates`)

- [ ] Create `templates/base/` from Nexus, remove branding
- [ ] Create `templates/with-db/`
- [ ] Create `templates/with-auth/`
- [ ] Create `templates/with-trpc/`
- [ ] Add `{{VAR}}` placeholders
- [ ] Test manually: generate an app, run it

### Phase 5: Validate (`validate-output`)

- [ ] Write `tests/scaffold.test.ts`
- [ ] Test all 5 combos (see above)
- [ ] Add to CI

### Phase 6: Publish (`publish`)

- [ ] Check npm availability: `npm view create-tr-stack`
- [ ] If taken, pivot to `@tr-stack/create` or similar
- [ ] Set up NPM_TOKEN secret in GitHub
- [ ] Tag `v1.0.0`, push, verify publish
- [ ] Update README with install instructions

---

## Future Enhancements (out of scope for MVP)

- **Monorepo mode**: `--monorepo` flag to scaffold Turborepo structure
- **Additional DBs**: `--db=mysql`, `--db=sqlite`
- **Additional auth providers**: `--auth=clerk`, `--auth=lucia`
- **Interactive init**: `pnpm create tr-stack` with no args opens full wizard