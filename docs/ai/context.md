---
title: Project Context
created: 2025-12-29
updated: 2026-03-07
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

Terse background for AI agents. See also CLAUDE.md for quick reference.

## What is Nexus?

A **deep storage solution** using AWS S3 cold/archival tiers. Users upload files for long-term, cost-effective storage — retrieval takes hours, not seconds. "Cloud storage for archival."

## Problem & Users

- Cloud storage is expensive at scale; archival storage is cheap but complex
- Target: photographers, video creators, small businesses with compliance/archival needs

## Business Model

Subscription-based pricing, tiers based on storage amount.

## Technical Stack

| Component      | Choice                            |
| -------------- | --------------------------------- |
| Frontend + API | Next.js 16 (App Router, RSC)      |
| Database       | Supabase (PostgreSQL via Drizzle) |
| Auth           | BetterAuth (Drizzle adapter)      |
| Storage        | AWS S3 (Glacier-first)            |
| Payments       | Stripe subscriptions              |
| Deployment     | Vercel                            |
| Monorepo       | pnpm + Turborepo                  |
| IaC            | Terraform                         |
| Styling        | Tailwind CSS                      |
| API Layer      | tRPC v11                          |
| Data Fetching  | TanStack Query v5 (via tRPC)      |
| Forms          | TanStack Form + Zod               |
| UI Components  | shadcn/ui + Lucide icons          |
| Testing        | Vitest + Playwright               |

## Data Model

```
User { id, email, subscription (stripe), files[] }
File { id, user_id, name, size, mime_type, s3_key, storage_tier, retrieval_status }
```

## Key Flows

**Upload:** User selects files → tRPC initiates chunked upload → S3 (Glacier) → metadata saved → visible in dashboard.

**Retrieval:** User requests download → Glacier restore (3-12 hours) → notification → presigned download URL → time-limited access.

## File Locations

| Concern            | Location                        |
| ------------------ | ------------------------------- |
| Pages/Routes       | `apps/web/app/`                 |
| UI Components      | `apps/web/components/ui/`       |
| Feature Components | `apps/web/components/features/` |
| tRPC Router        | `apps/web/server/trpc/`         |
| Database Schema    | `packages/db/src/schema/`       |
| Auth               | `apps/web/lib/auth.ts`          |
| S3 Operations      | `apps/web/lib/storage/`         |
| Environment        | `apps/web/lib/env/`             |
| Infrastructure     | `infra/terraform/`              |
| Documentation      | `docs/`                         |

## Current Phase

**POC Complete → MVP Development.** Core features only — no mobile, teams, dev API, advanced search, or automation rules.

## Key Constraints

1. Keep it simple — "poster project" mentality
2. Build for flexibility — all components swappable
3. Don't over-engineer — solve today's problems
4. Security first — user data is sensitive

## Environment Variables

Managed via Vercel (`pnpm env:pull`). Type-safe access via `@/lib/env` (Zod validation).

## Related

- [[patterns|Code Patterns]]
- [[conventions|Conventions]]
- [[_index|Back to AI Docs]]
