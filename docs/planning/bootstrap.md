---
title: Bootstrap Guide
created: 2025-12-29
updated: 2025-12-29
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
cd apps/web
mkdir -p components/ui components/features
mkdir -p server/trpc server/db
mkdir -p lib actions types
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

## Phase 3: Core Dependencies

### 3.1 shadcn/ui

```bash
cd apps/web
pnpm dlx shadcn@latest init
```

**Options:**

- Style: Default
- Base color: Neutral (or preference)
- CSS variables: Yes

### 3.2 Drizzle ORM

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
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

**server/db/schema.ts:**

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### 3.3 tRPC v11

```bash
pnpm add @trpc/server @trpc/client @trpc/tanstack-react-query
pnpm add @tanstack/react-query
pnpm add superjson
```

**server/trpc/init.ts:**

```typescript
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

const t = initTRPC.create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
```

**server/trpc/router.ts:**

```typescript
import { router } from './init';
import { filesRouter } from './routers/files';

export const appRouter = router({
    files: filesRouter,
});

export type AppRouter = typeof appRouter;
```

### 3.4 Supabase

```bash
pnpm add @supabase/ssr @supabase/supabase-js
```

**lib/supabase/server.ts:**

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options)
                    );
                },
            },
        }
    );
}
```

### 3.5 Supporting libraries

```bash
pnpm add zod lucide-react sonner @tanstack/react-form date-fns
```

---

## Phase 4: Testing Setup

### 4.1 Vitest

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
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
3. `chore: add core dependencies (shadcn, drizzle, trpc, supabase)`
4. `chore: add testing setup (vitest, playwright)`
5. `chore: add terraform infrastructure`

---

## Related

- [[tech-stack|Tech Stack]] - All technology decisions
- [[roadmap|Roadmap]] - Project phases
- [[planning/_index|Back to Planning]]
