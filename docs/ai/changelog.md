---
title: AI Changelog
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
    - ai
    - changelog
    - meta
aliases:
    - AI Changes
    - Session Log
ai_summary: 'Recent AI changes - READ THIS FIRST for context'
---

# AI Changelog

Recent changes made by AI assistants. **Read this first** to understand recent context.

---

## 2025-12-30

### Session: Supabase New API Keys

Updated env var names to match Supabase's new API key system.

**Changes:**

| Old Name | New Name |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` |

**Files Modified:**

- `apps/web/lib/env.ts` - Updated schema
- `apps/web/.env.example` - Updated template
- `turbo.json` - Updated env var references
- `docs/guides/environment-setup.md` - Updated docs with new key names

**Why:** Supabase introduced new `sb_publishable_...` and `sb_secret_...` keys to replace JWT-based anon/service_role keys. New projects only have the new keys.

---

### Session: Drizzle ORM Setup & Database Workflow

Added Drizzle ORM and defined the database workflow for AI-assisted development.

**Decisions Made:**

- **Migrations over push** - Use `db:generate` + `db:migrate` for all changes (not `db:push`)
- **Single environment** - Local dev uses cloud Supabase (no local Docker)
- **Custom migrations** - Use `db:custom <name>` for RLS policies, functions, triggers
- **AI rules** - Never manually create migration files, always use drizzle-kit

**Packages Added:**

- `drizzle-orm` - ORM with type-safe queries
- `postgres` - Postgres.js driver
- `dotenv` - Env loading for drizzle-kit CLI
- `drizzle-kit` (dev) - Migrations and studio

**Files Created:**

- `apps/web/drizzle.config.ts` - Drizzle config with dotenv for CLI commands
- `apps/web/server/db/schema.ts` - Initial schema with users table
- `apps/web/server/db/index.ts` - Database client export
- `docs/guides/database-workflow.md` - Full migration workflow documentation

**Files Modified:**

- `apps/web/package.json` - Added db:generate, db:migrate, db:push, db:studio, db:custom, typecheck scripts
- `docs/ai/conventions.md` - Added Database (Drizzle) section with AI rules
- `docs/guides/environment-setup.md` - Clarified single-env (cloud-only) approach

**Why migrations over push:**

1. Git history of all schema changes
2. Can include RLS policies, functions, triggers in migrations
3. Reproducible across environments
4. Safer - review SQL before applying

**Migration workflow:**

```bash
# Schema changes
pnpm -F web db:generate
pnpm -F web db:migrate

# RLS/functions
pnpm -F web db:custom add-rls-policies
# Edit the SQL file
pnpm -F web db:migrate
```

---

### Session: Environment Setup & Type-Safe Configuration

Added environment variable management strategy with type-safe validation.

**Decisions Made:**

- **Env file location:** `apps/web/` (Next.js auto-loads)
- **Source of truth:** Vercel dashboard, pulled via `pnpm env:pull`
- **Type safety:** Manual Zod validation in `lib/env.ts`
- **Database access:** Both Drizzle (direct Postgres) and Supabase client

**Files Created:**

- `docs/guides/environment-setup.md` - Full environment documentation
- `apps/web/.env.example` - Template with all 13 env vars
- `apps/web/lib/env.ts` - Zod validation & typed exports

**Files Modified:**

- `docs/planning/bootstrap.md` - Added step 3.2 for environment setup
- `docs/ai/context.md` - Updated env vars section, added DATABASE_URL
- `package.json` - Added `env:pull` script

**Why:** Environment setup was missing from bootstrap guide. Added type-safe validation to fail fast on missing vars and provide TypeScript autocomplete.

**Notes:**

- Use `vercel link` first (one-time), then `pnpm env:pull`
- Server vars validated separately from client (NEXT_PUBLIC_) vars
- DATABASE_URL needed for Drizzle direct Postgres access

---

## 2025-12-29

### Session: Supporting Libraries & Final Tech Decisions

Completed all technical decisions for the MVP stack.

**Decisions Made:**

- **Next.js 16** - Updated from 15, with `proxy.ts`, `"use cache"`, Turbopack, React 19.2
- **API Layer:** tRPC v11 with new TanStack Query v5 integration
- **UI:** shadcn/ui (Base UI), Lucide icons, Sonner toasts
- **Forms:** TanStack Form + Zod validation
- **Testing:** Vitest + @testing-library/react (unit), Playwright (E2E)
- **Linting:** ESLint + Prettier
- **Utilities:** date-fns, superjson
- **Glacier-first storage** - All files go to Glacier by default

**Files Modified:**

- `docs/architecture/tech-stack.md` - Added Supporting Libraries section, updated Testing
- `docs/ai/context.md` - Added all library decisions, updated file locations for tRPC
- `docs/guides/nextjs-patterns.md` - Updated for Next.js 16 (`proxy.ts`, `"use cache"`)
- `CLAUDE.md` - Updated stack to Next.js 16, added key decisions

**Why:** Final review of all technical choices before starting implementation. Chose tools that work well together (TanStack ecosystem, shadcn + Tailwind, Drizzle + Zod).

---

### Session: Monorepo & Infrastructure Decisions

Documented monorepo structure and infrastructure-as-code decisions.

**Decisions Made:**

- **Monorepo tooling:** pnpm workspaces + Turborepo
- **IaC:** Terraform (over CDK, for cloud-agnostic flexibility)
- **Structure:** `apps/web/` for Next.js, `infra/terraform/` for AWS
- **Shared packages:** Add `packages/` when needed, not upfront

**Files Modified:**

- `docs/architecture/tech-stack.md` - Added Monorepo Tooling and Terraform sections
- `docs/architecture/system-design.md` - Added Repository Structure section
- `docs/ai/context.md` - Updated file paths to `apps/web/` prefix, added IaC to decisions

**Why:** Finalizing architecture decisions before building. Terraform chosen after consulting with someone with more devops experience.

---

### Session: AI Documentation Simplification

Removed overly prescriptive rules and undefined patterns from AI documentation.

**Files Modified:**

- `CLAUDE.md` - Removed Do's/Don'ts lists, removed app directory structure
- `.cursorrules` - Removed patterns section and avoid section, simplified
- `docs/ai/patterns.md` - Removed all code examples, marked as draft
- `docs/ai/conventions.md` - Removed app directory structure and Server/Client Component patterns

**Why:** User feedback that defining hard rules limits AI creativity and can cause over-focus on don'ts. App structure isn't finalized, so specific patterns shouldn't be defined yet.

**Notes:**

- Keep general code quality guidelines (TypeScript, naming, error handling)
- Remove specific architecture that isn't decided yet
- Patterns will be added as they emerge during development

---

### Session: AI Documentation Setup

Created AI-friendly documentation structure for Claude Code and Cursor.

**Files Created:**

- `docs/ai/_index.md` - AI docs hub
- `docs/ai/context.md` - Project background and architecture
- `docs/ai/conventions.md` - Naming and style rules
- `docs/ai/patterns.md` - Code pattern templates
- `docs/ai/changelog.md` - This file
- `CLAUDE.md` - Root context for Claude Code
- `.cursorrules` - Root context for Cursor

**Why:** Enable AI assistants to understand the project instantly and generate consistent code.

**Notes:**

- All AI docs use `ai_summary` frontmatter for quick parsing
- Patterns are copy-paste ready templates
- Check `conventions.md` before generating code

---

### Session: Obsidian Enhancement

Added Canvas and Excalidraw support for visual documentation.

**Files Created:**

- `docs/architecture/system-overview.canvas` - Interactive architecture board
- `docs/architecture/drawings/` - Folder for Excalidraw diagrams

**Files Modified:**

- `docs/.obsidian/community-plugins.json` - Added excalidraw plugin
- `docs/architecture/_index.md` - Added Visual Tools section
- `docs/contributing.md` - Added Canvas/Excalidraw instructions

**Notes:**

- Canvas is for high-level architecture boards
- Excalidraw is for detailed hand-drawn diagrams
- Excalidraw files saved to `architecture/drawings/`

---

### Session: Documentation Vault Improvements

Added ADRs, dev journal, and additional templates.

**Files Created:**

- `docs/decisions/_index.md` - ADR index
- `docs/journal/_index.md` - Dev journal index
- `docs/templates/adr-template.md` - Architecture Decision Record template
- `docs/templates/meeting-notes-template.md` - Meeting notes template
- `docs/templates/feature-spec-template.md` - Feature specification template
- `docs/templates/daily-note-template.md` - Daily dev note template
- `docs/changelog.md` - Project changelog
- `docs/contributing.md` - Contribution guidelines

**Notes:**

- ADRs use numbered format: `001-decision-name.md`
- Daily notes configured for Templater plugin
- All templates use Templater syntax

---

### Session: Notion to Obsidian Migration

Migrated all documentation from Notion to Obsidian vault.

**Structure Created:**

```
docs/
├── index.md                # Main hub
├── architecture/           # System design
│   ├── tech-stack.md
│   ├── principles.md
│   └── system-design.md
├── guides/                 # How-to docs
│   ├── getting-started.md
│   └── nextjs-patterns.md
├── planning/               # Roadmap, planning
│   ├── mvp-notes.md
│   └── roadmap.md
└── resources/              # External links
    └── references.md
```

**Features Implemented:**

- YAML frontmatter on all docs
- Obsidian callouts (> [!note], etc.)
- Wikilinks for internal navigation
- Dataview queries for dynamic content
- Tags: #architecture, #guide, #planning, etc.

**Plugins Configured:**

- Dataview (required for queries)
- Templater (for templates)

**Notes:**

- Task tracking removed per user preference
- Emojis removed from filenames
- POC status preserved in prose

---

## How to Update This File

After completing significant work:

1. Add new entry under today's date (or create new date heading)
2. Use format: `### Session: Brief Description`
3. List files created/modified
4. Explain **WHY**, not just what
5. Add **Notes** for gotchas or context

Example:

```markdown
### Session: Auth Implementation

- Created `lib/auth/session.ts`
- Updated `middleware.ts`
- **Note:** Using Supabase auth helpers, not custom JWT
```
