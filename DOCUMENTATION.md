# Nexus - Documentation

> Deep storage made simple. A cost-effective archival solution using AWS S3 Glacier.

Nexus is a web application that provides affordable long-term file storage by leveraging AWS S3 Glacier tiers. Think "Dropbox for archival" -- upload files you want to keep long-term without paying for instant access you don't need.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Authentication](#authentication)
- [Storage System](#storage-system)
- [API Layer (tRPC)](#api-layer-trpc)
- [Background Jobs](#background-jobs)
- [Payments & Billing](#payments--billing)
- [Webhooks](#webhooks)
- [Testing](#testing)
- [Commands Reference](#commands-reference)
- [Deployment](#deployment)
- [Code Conventions](#code-conventions)
- [Contributing](#contributing)

---

## Architecture Overview

Nexus follows a layered server architecture with clear separation of concerns:

```
Browser
  │
  ├── Next.js App Router (SSR + RSC)
  │     │
  │     ├── tRPC Client ──────► tRPC Server
  │     │                          │
  │     │                     Service Layer (business logic)
  │     │                          │
  │     │                     Repository Layer (data access)
  │     │                          │
  │     │                     PostgreSQL (Supabase)
  │     │
  │     ├── Presigned URLs ───► AWS S3 (direct upload/download)
  │     │
  │     └── Route Handlers
  │           ├── /api/auth       → BetterAuth
  │           ├── /api/trpc       → tRPC endpoint
  │           └── /api/webhooks   → Stripe + SNS
  │
  └── Background Processing
        │
        SQS Queue ──► Lambda Worker ──► Job Handlers
```

### Key Data Flows

**File Upload:**

1. Client requests a presigned upload URL via tRPC
2. Browser uploads directly to S3 using the presigned URL
3. File metadata is stored in the database
4. Storage usage counters are updated

**File Retrieval (from Glacier):**

1. User requests a file download
2. System checks the current storage tier
3. If the file is in Glacier/Deep Archive, a restore is initiated
4. The user is notified of the estimated restore time (3-48 hours depending on tier)
5. A background job monitors restore progress
6. Once restored, a presigned download URL is generated

---

## Tech Stack

| Layer          | Technology                         | Purpose                            |
| -------------- | ---------------------------------- | ---------------------------------- |
| Framework      | Next.js 16, React 19               | Full-stack web application         |
| Language       | TypeScript 5                       | Type safety across the stack       |
| Database       | Supabase (PostgreSQL)              | Managed PostgreSQL with RLS        |
| ORM            | Drizzle ORM                        | Type-safe SQL queries & migrations |
| Authentication | BetterAuth                         | Session-based auth                 |
| API            | tRPC v11                           | End-to-end type-safe API           |
| Storage        | AWS S3 + Glacier                   | Object storage with archival tiers |
| Payments       | Stripe                             | Subscription billing               |
| UI             | Tailwind CSS 4, shadcn/ui, Base UI | Component library & styling        |
| State          | TanStack Query v5, TanStack Form   | Server state & form management     |
| Monorepo       | pnpm workspaces + Turborepo        | Package management & task running  |
| Testing        | Vitest (unit), Playwright (E2E)    | Test framework                     |
| IaC            | Terraform                          | AWS infrastructure provisioning    |
| Hosting        | Vercel                             | Deployment & edge functions        |
| Logging        | Pino                               | Structured server-side logging     |
| Validation     | Zod 4                              | Schema validation                  |

---

## Project Structure

```
nexus/
├── apps/
│   ├── web/                        # Next.js application
│   │   ├── app/                    # App Router
│   │   │   ├── (auth)/             # Auth pages (login, register)
│   │   │   ├── (dashboard)/        # Protected dashboard routes
│   │   │   ├── api/
│   │   │   │   ├── auth/[...all]/  # BetterAuth route handler
│   │   │   │   ├── trpc/[trpc]/    # tRPC HTTP handler
│   │   │   │   └── webhooks/       # Stripe & S3 restore webhooks
│   │   │   └── design/             # Design system showcase
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── auth/               # Auth components
│   │   │   ├── dashboard/          # Dashboard components
│   │   │   ├── landing/            # Landing page sections
│   │   │   └── icons/              # Custom SVG icons
│   │   ├── server/
│   │   │   ├── services/           # Business logic layer
│   │   │   │   ├── files.ts
│   │   │   │   ├── retrieval.ts
│   │   │   │   ├── s3-restore.ts
│   │   │   │   └── storage.ts
│   │   │   ├── trpc/
│   │   │   │   ├── init.ts         # tRPC initialization & middleware
│   │   │   │   ├── router.ts       # Root router composition
│   │   │   │   └── routers/        # Feature-specific routers
│   │   │   ├── db/                 # Drizzle client instance
│   │   │   └── errors.ts           # Domain error definitions
│   │   ├── lib/
│   │   │   ├── env/                # Type-safe env variable validation
│   │   │   ├── auth/               # BetterAuth config (client + server)
│   │   │   ├── storage/            # S3 operations module
│   │   │   ├── stripe/             # Stripe SDK & checkout
│   │   │   ├── trpc/               # tRPC client utilities
│   │   │   ├── http/               # HTTP utilities
│   │   │   ├── jobs/               # Background job utilities
│   │   │   ├── logger/             # Pino logging setup
│   │   │   ├── sns/                # AWS SNS webhook utilities
│   │   │   └── async/              # Async helpers
│   │   ├── e2e/                    # Playwright E2E tests
│   │   │   ├── smoke/              # Smoke tests for all pages
│   │   │   ├── admin/              # Admin-specific tests
│   │   │   └── fixtures.ts         # Test data & helpers
│   │   ├── public/                 # Static assets
│   │   ├── next.config.ts
│   │   ├── playwright.config.ts
│   │   └── vitest.config.ts
│   │
│   └── worker/                     # AWS Lambda background worker
│       └── src/
│           ├── handler.ts          # Lambda entry point
│           ├── registry.ts         # Job type → handler mapping
│           └── handlers/           # Individual job handlers
│
├── packages/
│   ├── db/                         # @nexus/db - shared database package
│   │   └── src/
│   │       ├── schema/             # Drizzle table definitions
│   │       │   ├── auth.ts         # User, session, account tables
│   │       │   ├── storage.ts      # Files, storage usage, retrievals
│   │       │   ├── subscriptions.ts# Subscription & billing
│   │       │   ├── jobs.ts         # Background jobs
│   │       │   ├── webhooks.ts     # Webhook event tracking
│   │       │   └── helpers.ts      # Shared schema utilities
│   │       └── repositories/       # Data access layer
│   │           ├── files.ts
│   │           ├── jobs.ts
│   │           ├── retrievals.ts
│   │           ├── subscriptions.ts
│   │           └── webhooks.ts
│   │
│   └── trpc-devtools/              # Standalone tRPC dev tools package
│
├── docs/                           # Documentation (Obsidian vault)
│   ├── ai/                         # AI assistant context
│   ├── architecture/               # System design & tech decisions
│   ├── conventions/                # Code style & naming rules
│   ├── guides/                     # How-to guides
│   ├── planning/                   # Roadmap & MVP scope
│   └── decisions/                  # Architecture Decision Records
│
├── scripts/                        # Build & deployment scripts
├── turbo.json                      # Turborepo pipeline config
├── pnpm-workspace.yaml             # Workspace package definitions
└── package.json                    # Root scripts & config
```

---

## Getting Started

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Vercel CLI** (for environment variable management)
- **AWS account** with S3 and SQS access
- **Supabase** project
- **Stripe** account (for billing features)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd nexus

# Install dependencies
pnpm install

# Link Vercel project and pull environment variables
vercel link
pnpm env:pull

# Run database migrations
pnpm -F db db:migrate

# Start the development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

---

## Environment Variables

Environment variables are managed via Vercel and validated at runtime using Zod schemas. After running `pnpm env:pull`, the variables are stored in `apps/web/.env.local`.

### Server Variables

| Variable                | Required | Description                             |
| ----------------------- | -------- | --------------------------------------- |
| `DATABASE_URL`          | Yes      | Supabase PostgreSQL connection string   |
| `SUPABASE_SECRET_KEY`   | Yes      | Supabase service role key (for RLS)     |
| `AWS_ACCESS_KEY_ID`     | Yes      | AWS IAM access key                      |
| `AWS_SECRET_ACCESS_KEY` | Yes      | AWS IAM secret key                      |
| `AWS_REGION`            | Yes      | AWS region (e.g., `us-east-1`)          |
| `S3_BUCKET`             | Yes      | S3 bucket name                          |
| `SQS_QUEUE_URL`         | Yes      | SQS queue URL for background jobs       |
| `STRIPE_SECRET_KEY`     | Yes      | Stripe secret API key                   |
| `STRIPE_WEBHOOK_SECRET` | Yes      | Stripe webhook signing secret           |
| `BETTER_AUTH_SECRET`    | Yes      | Auth session signing key (min 32 chars) |
| `LOG_ERROR_VERBOSITY`   | No       | Error logging detail level              |

### Client Variables

| Variable                               | Required | Description                                 |
| -------------------------------------- | -------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes      | Supabase project URL                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes      | Supabase anonymous/public key               |
| `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`        | Yes      | Stripe publishable key                      |
| `NEXT_PUBLIC_APP_URL`                  | Yes      | Application URL (e.g., `https://nexus.app`) |

Environment variables are accessed via a type-safe proxy in `apps/web/lib/env/`:

```typescript
import { env } from '@/lib/env';

// Type-safe access - throws at runtime if missing
const bucket = env.S3_BUCKET;
```

---

## Database

### ORM & Migrations

Nexus uses **Drizzle ORM** with PostgreSQL hosted on **Supabase**. The schema is defined in `packages/db/src/schema/` and shared across the monorepo as `@nexus/db`.

```bash
# Generate a migration from schema changes
pnpm -F db db:generate

# Apply pending migrations
pnpm -F db db:migrate

# Open Drizzle Studio (visual database browser)
pnpm -F db db:studio

# Create an empty migration (for RLS policies, functions, etc.)
pnpm -F db db:custom <migration-name>
```

### Schema Overview

#### Users & Authentication (`auth.ts`)

| Table          | Description                           |
| -------------- | ------------------------------------- |
| `user`         | User accounts (id, email, name, role) |
| `session`      | Active sessions                       |
| `account`      | OAuth provider links                  |
| `verification` | Email verification tokens             |

User roles: `user` | `admin`

#### File Storage (`storage.ts`)

| Table          | Description                     |
| -------------- | ------------------------------- |
| `files`        | File metadata and S3 references |
| `storageUsage` | Per-user storage consumption    |
| `retrievals`   | Glacier restore requests        |

Key enums:

- **Storage Tier:** `standard` | `glacier` | `deep_archive`
- **File Status:** `uploading` | `available` | `restoring` | `deleted`
- **Retrieval Status:** `pending` | `in_progress` | `ready` | `expired` | `failed` | `cancelled`
- **Restore Tier:** `standard` | `bulk` | `expedited`

#### Subscriptions (`subscriptions.ts`)

| Table           | Description               |
| --------------- | ------------------------- |
| `subscriptions` | Stripe subscription state |

Plan tiers: `starter` | `pro` | `max` | `enterprise`

#### Background Jobs (`jobs.ts`)

| Table            | Description                    |
| ---------------- | ------------------------------ |
| `backgroundJobs` | Job queue with status tracking |

Job statuses: `pending` | `processing` | `completed` | `failed`

#### Webhook Events (`webhooks.ts`)

| Table           | Description                  |
| --------------- | ---------------------------- |
| `webhookEvents` | Idempotent webhook event log |

Sources: `stripe` | `sns`

### Repository Pattern

Data access is organized into repository modules in `packages/db/src/repositories/`. Each repository uses a factory pattern for transaction support:

```typescript
import { createRepository } from './files';

const filesRepo = createRepository(db);
const userFiles = await filesRepo.getByUserId(userId);
```

---

## Authentication

Nexus uses **BetterAuth** with a Drizzle adapter for session-based authentication.

### Configuration

- **Session duration:** 7 days
- **Session update age:** 24 hours
- **Auth methods:** Email/password
- **Role system:** `user` (default) | `admin` (server-assigned)

### Auth Routes

- `/api/auth/[...all]` -- BetterAuth catch-all route handler
- Login/register pages under the `(auth)` route group

### Usage

```typescript
// Server-side (tRPC, route handlers)
import { auth } from '@/lib/auth/server';

const session = await auth.api.getSession({ headers });

// Client-side
import { authClient } from '@/lib/auth/client';

const { data: session } = authClient.useSession();
```

---

## Storage System

The storage module (`apps/web/lib/storage/`) provides a namespace-exported API for all S3 operations:

```typescript
import { s3 } from '@/lib/storage';

// Generate presigned upload URL
const uploadUrl = await s3.presigned.upload(key, contentType);

// Generate presigned download URL
const downloadUrl = await s3.presigned.download(key);

// Initiate Glacier restore
await s3.glacier.restore(key, tier);

// Delete an object
await s3.objects.delete(key);

// Multipart upload operations
const upload = await s3.multipart.create(key, contentType);
```

### Storage Tiers

| Tier         | Access Time | Cost    | Use Case           |
| ------------ | ----------- | ------- | ------------------ |
| Standard     | Instant     | Highest | Recently uploaded  |
| Glacier      | 3-5 hours   | Low     | Infrequent access  |
| Deep Archive | 12-48 hours | Lowest  | Long-term archival |

Files default to **Deep Archive** for maximum cost savings. The lifecycle policy transitions files from Standard to Deep Archive automatically.

### Restore Tiers (for Glacier/Deep Archive)

| Tier      | Time          | Cost    | Availability          |
| --------- | ------------- | ------- | --------------------- |
| Expedited | 1-5 minutes   | Highest | Glacier only (not DA) |
| Standard  | 3-5 / 12 hrs  | Medium  | Both tiers            |
| Bulk      | 5-12 / 48 hrs | Lowest  | Both tiers            |

---

## API Layer (tRPC)

Nexus uses **tRPC v11** with **TanStack Query v5** for end-to-end type-safe API calls.

### Router Structure

```
appRouter
├── admin           # Admin-only operations
├── auth            # Session management
├── debug           # Development utilities
├── files           # File CRUD (upload, list, delete)
├── retrievals      # Glacier restore requests
└── storage         # Storage tier & usage info
```

### Server-Side Architecture

Each tRPC procedure follows the layered pattern:

```
tRPC Procedure         → Input validation (Zod) + auth guards
    ↓
Service Layer          → Business logic, orchestration
    ↓
Repository Layer       → Database queries (Drizzle)
    ↓
Database               → PostgreSQL (Supabase)
```

### Error Handling

- Domain errors define user-facing messages in `server/errors.ts`
- A global tRPC error middleware converts errors to toast notifications via Sonner
- `INTERNAL_SERVER_ERROR` uses a generic fallback message (no leak of internals)

### Client Usage

```typescript
// In React components
import { trpc } from '@/lib/trpc/client';

// Query
const { data: files } = trpc.files.list.useQuery();

// Mutation
const uploadMutation = trpc.files.createUploadUrl.useMutation();
```

---

## Background Jobs

Background processing is handled by an **AWS Lambda** worker that consumes messages from an **SQS** queue.

### How It Works

1. The web app creates a job: inserts a record in `background_jobs` table + sends an SQS message
2. The Lambda worker receives the message
3. The worker routes the job to the appropriate handler via a type registry
4. The handler processes the job and updates the status
5. Failed jobs retry up to **3 times** before being sent to a Dead Letter Queue (DLQ)

### Job Lifecycle

```
pending → processing → completed
                    ↘ failed (retry up to 3x → DLQ)
```

### Adding a New Job Type

1. Define the job type and payload schema
2. Create a handler in `apps/worker/src/handlers/`
3. Register the handler in `apps/worker/src/registry.ts`
4. Enqueue from the web app using the job utility in `apps/web/lib/jobs/`

---

## Payments & Billing

Nexus uses **Stripe** for subscription-based billing.

### Subscription Tiers

| Tier       | Description               |
| ---------- | ------------------------- |
| Starter    | Basic storage allocation  |
| Pro        | Increased storage limit   |
| Max        | Large storage capacity    |
| Enterprise | Custom storage & features |

Each tier defines a `storageLimit` in the `subscriptions` table.

### Stripe Integration

```typescript
import { stripe } from '@/lib/stripe';

// Create a checkout session
const session = await stripe.checkout.createSession({
    userId,
    priceId,
    successUrl,
    cancelUrl,
});
```

### Subscription Statuses

`trialing` | `active` | `past_due` | `canceled` | `unpaid` | `incomplete`

---

## Webhooks

Nexus processes webhooks from two sources:

### Stripe Webhooks (`/api/webhooks/stripe`)

- Receives subscription lifecycle events (created, updated, canceled)
- Verifies request signatures using `STRIPE_WEBHOOK_SECRET`
- Processes the raw request body for signature verification

### S3 Restore Webhooks (`/api/webhooks/s3-restore`)

- Receives AWS SNS notifications when Glacier restores complete
- Verifies SNS message signatures
- Updates retrieval status and notifies users

### Idempotency

All webhook events are tracked in the `webhook_events` table with an `external_id` field. This prevents duplicate processing if the same event is delivered more than once.

---

## Testing

### Unit Tests (Vitest)

Unit tests cover utilities, pure functions, and business logic. They are colocated with source files using the `*.test.ts` naming convention.

```bash
# Run unit tests
pnpm test

# Run with coverage report
pnpm test:coverage
```

### E2E Tests (Playwright)

E2E tests cover multi-step user interactions, authentication flows, and data-driven UI.

```bash
# Run all E2E tests
pnpm -F web test:e2e

# Run smoke tests only (required after UI changes)
pnpm -F web test:e2e:smoke

# Run admin-specific tests
pnpm -F web test:e2e:admin
```

**Smoke tests** exist for every page and verify basic rendering without console errors. They live in `apps/web/e2e/smoke/`.

### When to Write Tests

| Scenario                    | Test Type |
| --------------------------- | --------- |
| Pure functions, utilities   | Unit      |
| Multi-step user flows       | E2E       |
| Auth-gated pages            | E2E       |
| Data-dependent rendering    | E2E       |
| Static pages, simple layout | Smoke     |

---

## Commands Reference

### Root Level

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `pnpm dev`           | Start the development server                    |
| `pnpm build`         | Build all workspaces                            |
| `pnpm lint`          | Run ESLint across all packages                  |
| `pnpm test`          | Run unit tests across all packages              |
| `pnpm typecheck`     | Run TypeScript type checking                    |
| `pnpm check`         | **Required before commit:** lint + build + test |
| `pnpm test:coverage` | Generate coverage report                        |
| `pnpm test:e2e`      | Run all E2E tests                               |
| `pnpm env:pull`      | Pull environment variables from Vercel          |

### Web App (`pnpm -F web`)

| Command                      | Description        |
| ---------------------------- | ------------------ |
| `pnpm -F web dev`            | Next.js dev server |
| `pnpm -F web build`          | Production build   |
| `pnpm -F web test`           | Unit tests         |
| `pnpm -F web test:e2e:smoke` | Smoke tests        |
| `pnpm -F web test:e2e:admin` | Admin E2E tests    |

### Database (`pnpm -F db`)

| Command                       | Description                    |
| ----------------------------- | ------------------------------ |
| `pnpm -F db db:generate`      | Generate migration from schema |
| `pnpm -F db db:migrate`       | Apply pending migrations       |
| `pnpm -F db db:studio`        | Open Drizzle Studio            |
| `pnpm -F db db:custom <name>` | Create empty migration file    |

---

## Deployment

### Infrastructure

| Service      | Provider   | Purpose                           |
| ------------ | ---------- | --------------------------------- |
| Web App      | Vercel     | Next.js hosting, edge functions   |
| Database     | Supabase   | Managed PostgreSQL                |
| File Storage | AWS S3     | Object storage with Glacier tiers |
| Job Queue    | AWS SQS    | Message queue for background jobs |
| Worker       | AWS Lambda | Background job processor          |
| IaC          | Terraform  | AWS resource provisioning         |

### Deployment Pipeline

1. Push to `main` branch triggers Vercel deployment
2. Vercel builds the Next.js application
3. Database migrations run as part of the build process
4. Lambda worker is deployed separately via Terraform

### Infrastructure as Code

AWS resources (S3, SQS, IAM, Lambda) are managed with Terraform. Configuration files are in the project's infrastructure directory.

---

## Code Conventions

### File Naming

| Type       | Convention        | Example               |
| ---------- | ----------------- | --------------------- |
| Components | `PascalCase.tsx`  | `FileUploader.tsx`    |
| Utilities  | `camelCase.ts`    | `formatBytes.ts`      |
| Hooks      | `useCamelCase.ts` | `useFileUpload.ts`    |
| Unit Tests | `*.test.ts`       | `formatBytes.test.ts` |
| E2E Tests  | `*.spec.ts`       | `upload.spec.ts`      |

### Component Structure

- Use function declarations (not arrow functions) for components
- Props interface above the component
- Main export first, helper functions below

### Library Organization

Libraries in `lib/` are organized by domain:

- One concept per file
- Client/server split when needed (`client.ts` / `server.ts`)
- Namespace exports for grouped operations:

```typescript
export const s3 = {
    presigned,
    glacier,
    objects,
    multipart,
};
```

### Git Workflow

- **Conventional commits:** `feat: add login form (#42)`
- **Issue-first:** All non-trivial work must have a GitHub issue
- **PR references:** `Closes #42` or `No-Issue: <reason>` for trivial changes
- **Pre-commit check:** Always run `pnpm check` before committing

---

## Contributing

1. Check for an existing GitHub issue or create one
2. Create a feature branch from `main`
3. Follow the [code conventions](#code-conventions)
4. Run `pnpm check` (lint + build + test) before committing
5. Run `pnpm -F web test:e2e:smoke` if you changed UI
6. Open a PR referencing the issue (`Closes #XX`)

For detailed contribution guidelines, see `CONTRIBUTING.md`.
For complete coding conventions, see `docs/ai/conventions.md`.
