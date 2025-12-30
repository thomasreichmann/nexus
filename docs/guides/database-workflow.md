---
title: Database Workflow
created: 2025-12-30
updated: 2025-12-30
status: active
tags:
    - guide
    - database
    - drizzle
aliases:
    - Drizzle Workflow
    - Migrations
---

# Database Workflow

How to work with the database using Drizzle ORM.

## Environment Strategy

**Single environment approach:** All development runs against the cloud Supabase database. No local database setup.

- `.env.local` contains cloud credentials (pulled from Vercel)
- Run `pnpm env:pull` to get credentials
- Requires internet connection for development

## Commands

All commands run from `apps/web/`:

```bash
pnpm db:generate              # Generate migration from schema changes
pnpm db:migrate               # Apply pending migrations
pnpm db:push                  # Direct push (avoid - use migrations)
pnpm db:studio                # Open Drizzle Studio
pnpm db:custom <name>         # Generate empty migration for RLS/functions
```

Or from monorepo root:

```bash
pnpm -F web db:generate
pnpm -F web db:migrate
# etc.
```

## Migration Workflow

### Schema Changes (tables, columns)

1. Edit `server/db/schema.ts`
2. Generate migration: `pnpm db:generate`
3. Review generated SQL in `server/db/migrations/`
4. Apply: `pnpm db:migrate`
5. Commit schema + migration files

### Non-Schema Changes (RLS, functions, triggers)

1. Generate empty migration: `pnpm db:custom add-rls-policies`
2. Edit the generated SQL file in `server/db/migrations/`
3. Apply: `pnpm db:migrate`
4. Commit migration file

### Example: Adding RLS Policy

```bash
pnpm db:custom user-rls
```

Edit `server/db/migrations/XXXX_user-rls.sql`:

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  USING (auth.uid() = id);
```

Apply:

```bash
pnpm db:migrate
```

## Why Migrations Over Push

We use migrations (`db:generate` + `db:migrate`) instead of `db:push` because:

1. **Git history** - All changes tracked in version control
2. **Non-schema changes** - RLS policies, functions, triggers can be added to migrations
3. **Reproducible** - Same migrations run in any environment
4. **Safer** - Review SQL before applying

## De-sync Recovery

If the database gets out of sync with migrations:

```bash
# See actual database state
drizzle-kit pull

# Compare to schema.ts, reconcile manually

# If needed, edit __drizzle_migrations table to mark migrations as applied/unapplied
```

## File Structure

```
apps/web/
├── drizzle.config.ts         # Drizzle Kit configuration
└── server/db/
    ├── index.ts              # Database client
    ├── schema.ts             # Table definitions
    └── migrations/           # Generated SQL files
        ├── 0000_init.sql
        ├── 0001_add-rls.sql
        └── meta/             # Drizzle journal (don't edit manually)
```

## AI Assistant Rules

When working with AI assistants on database changes:

1. **Schema changes**: AI edits `schema.ts`, then runs `db:generate`
2. **RLS/functions**: AI runs `db:custom <name>`, then edits the generated SQL
3. **Never manually create migration files** - Always use drizzle-kit
4. **Never edit the `meta/` journal** - Managed by drizzle-kit
5. **Flag destructive changes** - AI should warn before dropping columns/tables

## Related

- [[environment-setup|Environment Setup]] - Env var configuration
- [[tech-stack|Tech Stack]] - Database technology decisions
