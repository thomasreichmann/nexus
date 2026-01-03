---
title: Bootstrap Guide
created: 2025-12-29
updated: 2026-01-03
status: active
tags:
    - planning
    - setup
    - guide
aliases:
    - Project Setup
    - Getting Started
---

# Bootstrap Plan

Step-by-step plan to initialize the Nexus monorepo from scratch.

## Phase 1: Root Monorepo Setup ✅

### 1.1 Initialize pnpm workspace

```bash
# Initialize root package.json
pnpm init

# Create workspace config
```

**pnpm-workspace.yaml:**

```yaml
packages:
    - 'apps/*'
    - 'packages/*'
```

### 1.2 Create turbo.json

```json
{
    "$schema": "https://turbo.build/schema.json",
    "tasks": {
        "build": {
            "dependsOn": ["^build"],
            "outputs": [".next/**", "dist/**"]
        },
        "dev": {
            "cache": false,
            "persistent": true
        },
        "lint": {},
        "test": {},
        "typecheck": {
            "dependsOn": ["^typecheck"]
        }
    }
}
```

### 1.3 Root configuration files

**.nvmrc:**

```
20
```

**.gitignore additions:**

```
# Dependencies
node_modules/

# Turbo
.turbo/

# Next.js
.next/
out/

# Build
dist/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/

# OS
.DS_Store

# Testing
coverage/
playwright-report/

# Terraform
infra/terraform/.terraform/
infra/terraform/*.tfstate*
```

### 1.4 Root package.json scripts

```json
{
    "name": "nexus",
    "private": true,
    "scripts": {
        "dev": "turbo dev",
        "build": "turbo build",
        "lint": "turbo lint",
        "test": "turbo test",
        "typecheck": "turbo typecheck"
    },
    "devDependencies": {
        "turbo": "^2"
    },
    "packageManager": "pnpm@9.15.0"
}
```

---

## Phase 2: Next.js App ✅

### 2.1 Create Next.js 16 app

```bash
pnpm create next-app@latest apps/web
```

**Options to select:**

- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- `src/` directory: No
- App Router: Yes
- Turbopack: Yes (default in Next.js 16)
- Import alias: @/\*

### 2.2 Configure ESLint + Prettier

```bash
pnpm -F web add -D prettier eslint-config-prettier eslint-plugin-prettier
```

**.prettierrc:**

```json
{
    "semi": true,
    "singleQuote": true,
    "tabWidth": 2,
    "trailingComma": "es5",
    "printWidth": 80
}
```

### 2.3 Create folder structure

```bash
mkdir -p apps/web/components/{ui,features}
mkdir -p apps/web/server/{trpc,db}
mkdir -p apps/web/{lib,actions,types}
```

**Final structure:**

```
apps/web/
├── app/                 # Routes
├── components/
│   ├── ui/             # shadcn components
│   └── features/       # Feature components
├── server/
│   ├── trpc/           # tRPC routers
│   └── db/             # Drizzle schema
├── lib/                # Utilities
├── actions/            # Server Actions
└── types/              # TypeScript types
```

---

## Phase 3: Core Dependencies ✅

### 3.1 shadcn/ui ✅

```bash
# Run from apps/web directory (shadcn needs to be in the app root)
cd apps/web && pnpm dlx shadcn@latest init && cd ../..
```

**Options:**

- Style: Default
- Base color: Neutral (or preference)
- CSS variables: Yes

### 3.2 Environment Setup ✅

**Create `.env.example` template:**

```bash
# apps/web/.env.example

# Database (Drizzle)
DATABASE_URL=postgresql://user:password@host:5432/postgres

# Auth (BetterAuth)
BETTER_AUTH_SECRET=your-secret-key-at-least-32-characters-long

# AWS S3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=nexus-storage-dev

# Stripe
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Add env script to root package.json:**

```json
{
    "scripts": {
        "env:pull": "vercel env pull apps/web/.env.local"
    }
}
```

**Create type-safe env validation (`lib/env/`):**

```typescript
import { z } from 'zod';

const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
});

const clientSchema = z.object({
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
});

const serverEnv = serverSchema.parse(process.env);
const clientEnv = clientSchema.parse({
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

export const env = { ...serverEnv, ...clientEnv };
```

**Pull environment variables from Vercel:**

```bash
vercel link      # First time only
pnpm env:pull    # Creates apps/web/.env.local
```

### 3.3 Drizzle ORM ✅

```bash
pnpm -F web add drizzle-orm postgres
pnpm -F web add -D drizzle-kit
```

**drizzle.config.ts:**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './server/db/schema.ts',
    out: './server/db/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
```

**server/db/schema.ts** - BetterAuth creates these tables:

```typescript
import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // ... additional fields
});

// Also: account, verification tables
```

### 3.4 tRPC v11 ✅

```bash
pnpm -F web add @trpc/server @trpc/client @trpc/tanstack-react-query @tanstack/react-query superjson
```

**server/trpc/init.ts:**

```typescript
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { headers } from 'next/headers';
import { db } from '@/server/db';
import { auth } from '@/lib/auth';

export async function createTRPCContext() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    return { db, session };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, session: ctx.session } });
});
```

**server/trpc/router.ts:**

```typescript
import { router } from './init';
import { authRouter } from './routers/auth';

export const appRouter = router({
    auth: authRouter,
});

export type AppRouter = typeof appRouter;
```

### 3.5 BetterAuth ✅

```bash
pnpm -F web add better-auth
```

**lib/auth.ts:**

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/server/db';
import * as schema from '@/server/db/schema';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    emailAndPassword: {
        enabled: true,
    },
});
```

**lib/auth-client.ts:**

```typescript
'use client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
export const { useSession, signIn, signUp, signOut } = authClient;
```

**app/api/auth/[...all]/route.ts:**

```typescript
import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth.handler);
```

### 3.6 Supporting libraries ✅

```bash
pnpm -F web add zod lucide-react sonner @tanstack/react-form date-fns
```

---

## Phase 4: Testing Setup

### 4.1 Vitest

```bash
pnpm -F web add -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

**vitest.config.ts:**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['**/*.test.{ts,tsx}'],
    },
});
```

**vitest.setup.ts:**

```typescript
import '@testing-library/jest-dom/vitest';
```

**Add to package.json:**

```json
{
    "scripts": {
        "test": "vitest",
        "test:run": "vitest run"
    }
}
```

### 4.2 Playwright

```bash
pnpm create playwright
```

**Options:**

- TypeScript: Yes
- Tests folder: e2e
- GitHub Actions: No (for now)
- Install browsers: Yes

---

## Phase 5: Infrastructure

### 5.1 Terraform structure

```bash
mkdir -p infra/terraform
```

**infra/terraform/main.tf:**

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

**infra/terraform/variables.tf:**

```hcl
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "nexus"
}
```

**infra/terraform/s3.tf:**

```hcl
resource "aws_s3_bucket" "storage" {
  bucket = "${var.project_name}-storage-${var.environment}"
}

resource "aws_s3_bucket_lifecycle_configuration" "glacier" {
  bucket = aws_s3_bucket.storage.id

  rule {
    id     = "glacier-transition"
    status = "Enabled"

    transition {
      days          = 0
      storage_class = "DEEP_ARCHIVE"
    }
  }
}
```

**infra/terraform/outputs.tf:**

```hcl
output "bucket_name" {
  value = aws_s3_bucket.storage.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.storage.arn
}
```

---

## Phase 6: Verification

Run these commands from the root to verify everything works:

```bash
# Install all dependencies
pnpm install

# Start dev server
pnpm dev

# Run linting
pnpm lint

# Run tests
pnpm test

# Build with Turborepo
turbo build
```

---

## Commit Checkpoints

Commit after each phase:

1. `chore: initialize monorepo with pnpm and turborepo`
2. `chore: add next.js 16 app with tailwind`
3. `chore: add core dependencies (shadcn, drizzle, trpc, betterauth)`
4. `chore: add testing setup (vitest, playwright)`
5. `chore: add terraform infrastructure`

---

## Related

- [[tech-stack|Tech Stack]] - All technology decisions
- [[roadmap|Roadmap]] - Project phases
- [[planning/_index|Back to Planning]]
