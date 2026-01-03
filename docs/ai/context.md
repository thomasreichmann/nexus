---
title: Project Context
created: 2025-12-29
updated: 2026-01-03
status: active
tags:
    - ai
    - context
    - architecture
aliases:
    - Background
    - Project Overview
ai_summary: 'Deep background on project goals, architecture, and business logic'
---

# Project Context

Detailed background for AI to understand the Nexus project deeply.

## What is Nexus?

Nexus is a **deep storage solution** that helps users store files cost-effectively using AWS S3 Glacier. All files go directly to cold storage - users understand upfront that retrieval takes time.

Think of it as "Dropbox for archival" - users upload files they want to keep long-term but don't need instant access to.

## Problem We're Solving

1. **Cloud storage is expensive** for large amounts of data
2. **Glacier is cheap but complex** - most users can't set it up
3. **No good middle-ground** between "instant access" and "tape archive"

## Target Users

- Photographers with large RAW file archives
- Video creators with project backups
- Small businesses with compliance/archival needs
- Anyone with data they want to keep but rarely access

## Business Model

- **Subscription-based** pricing (initially)
- Tiers based on storage amount
- Usage-based pricing considered for future

## Technical Architecture

### Frontend + Backend

- **Next.js 16** with App Router
- Server Components for performance
- Server Actions for mutations
- `proxy.ts` for network boundary
- Turbopack (default bundler)
- React 19.2 with React Compiler
- Deployed on **Vercel**

### Database

- **Supabase** (PostgreSQL)
- Row-level security for multi-tenancy
- Real-time subscriptions for status updates

### Storage

- **AWS S3** for file storage
- Glacier-first strategy (all files go to Glacier by default)
- Presigned URLs for secure uploads/downloads
- Chunked uploads for large files

### Authentication

- **BetterAuth** with Drizzle adapter
- Email/password initially
- OAuth providers later
- Session in database, integrates with tRPC context

### Payments

- **Stripe** subscriptions
- Webhook for subscription events

## Data Model (Conceptual)

```
User
├── id, email, created_at
├── subscription (stripe_customer_id, plan, status)
└── files[]

File
├── id, user_id
├── name, size, mime_type
├── s3_key, storage_tier
├── created_at, last_accessed_at
└── retrieval_status (for Glacier files)
```

## Key User Flows

### Upload Flow

1. User selects file(s)
2. Client initiates chunked upload via tRPC
3. Chunks uploaded directly to S3 (Glacier)
4. Metadata saved to Supabase
5. User sees file in dashboard

### Retrieval Flow

1. User requests file download
2. System initiates Glacier restore (takes 3-12 hours)
3. User notified when ready (realtime via Supabase)
4. Presigned download URL generated
5. File available for limited time

## Current Phase

**POC Complete** → **MVP Planning/Development**

- POC proved the concept works
- Now building production-ready MVP
- Focus on core features only

## Key Constraints

1. **Keep it simple** - "poster project" mentality
2. **Build for flexibility** - all components swappable
3. **Don't over-engineer** - solve today's problems
4. **Security first** - user data is sensitive

## What's NOT in MVP

- Mobile apps
- Team/collaboration features
- API for developers
- Advanced search
- Automated archiving rules

## Technical Decisions Made

| Decision      | Choice            | Rationale                                |
| ------------- | ----------------- | ---------------------------------------- |
| Framework     | Next.js           | Full-stack, great DX, Vercel integration |
| Database      | Supabase          | Postgres + Realtime in one               |
| Auth          | BetterAuth        | Drizzle adapter, tRPC integration        |
| Storage       | AWS S3            | Industry standard, Glacier support       |
| Payments      | Stripe            | Developer-friendly, subscription support |
| Deployment    | Vercel            | Best Next.js experience                  |
| Monorepo      | pnpm + Turborepo  | Fast installs, build caching             |
| IaC           | Terraform         | Cloud-agnostic, industry standard        |
| Styling       | Tailwind CSS      | Utility-first, rapid development         |
| Upload        | Chunked           | Reliability for large files              |
| Storage       | Glacier-first     | All files to Glacier by default          |
| ORM           | Drizzle           | TypeScript-native, SQL-like, AI-friendly |
| API Layer     | tRPC v11          | End-to-end typesafe APIs                 |
| Data Fetching | TanStack Query v5 | Via tRPC integration                     |
| Forms         | TanStack Form     | Modern, TypeScript-first                 |
| Validation    | Zod               | Integrates with Drizzle                  |
| UI Components | shadcn/ui         | Base UI primitives, Tailwind             |
| Icons         | Lucide            | Pairs with shadcn                        |
| Toasts        | Sonner            | Minimal, clean                           |
| Dates         | date-fns          | Tree-shakeable                           |
| Unit Testing  | Vitest            | Fast, ESM-native                         |
| E2E Testing   | Playwright        | Browser automation                       |
| Linting       | ESLint + Prettier | Mature tooling                           |

## File Locations

| Concern            | Location                        |
| ------------------ | ------------------------------- |
| Pages/Routes       | `apps/web/app/`                 |
| UI Components      | `apps/web/components/ui/`       |
| Feature Components | `apps/web/components/features/` |
| tRPC Router        | `apps/web/server/trpc/`         |
| Server Actions     | `apps/web/actions/`             |
| Database Schema    | `apps/web/server/db/`           |
| Auth               | `apps/web/lib/auth.ts`          |
| S3 Operations      | `apps/web/lib/s3/`              |
| Environment        | `apps/web/lib/env/`             |
| Types              | `apps/web/types/`               |
| Tests              | Colocated (`*.test.ts`)         |
| Infrastructure     | `infra/terraform/`              |
| Documentation      | `docs/`                         |

## Environment Variables

Managed via Vercel - pull locally with `pnpm env:pull`.

Type-safe access via `@/lib/env` (Zod validation at runtime).

```bash
# Database (Drizzle)
DATABASE_URL=

# Auth (BetterAuth)
BETTER_AUTH_SECRET=

# AWS S3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=
```

## Related

- [[patterns|Code Patterns]] - Implementation examples
- [[conventions|Conventions]] - Naming and style
- [[architecture/_index|Architecture Docs]] - Detailed technical docs
- [[ai/_index|Back to AI Docs]]
