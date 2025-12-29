---
title: Tech Stack
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - architecture
  - decision
  - nextjs
  - supabase
  - aws
aliases:
  - Technology Stack
  - Stack Decisions
---

# Tech Stack

Technology choices and rationale for the Nexus MVP.

## Decisions Made

### Frontend & Backend: Next.js 16

**Decision:** Full-stack Next.js 16 with App Router

**Frontend:**
- Server Components for optimal performance
- App Router for improved routing and layouts
- `"use cache"` directive for opt-in caching
- React 19.2 with View Transitions
- React Compiler (stable) for auto-memoization
- Streaming and Suspense for better UX

**Backend:**
- Route Handlers for API endpoints
- Server Actions for mutations
- `proxy.ts` for network boundary (replaces middleware)

**Build:**
- Turbopack (default bundler, 10x faster dev)
- Biome or ESLint for linting (next lint removed)

**Development:** AI-assisted (Cursor/Claude Code)

### Database: Supabase

- PostgreSQL database
- Built-in authentication
- Real-time capabilities
- Row-level security

**ORM:** Drizzle or Prisma (pending decision)

### Storage: AWS S3

- **S3 Standard** - for frequently accessed files
- **S3 Glacier Deep Archive** - for cold storage

> [!note] Storage Tiers
> The exact logic for when files transition from Standard to Deep Storage is still being defined. Key factors: access patterns, retrieval time requirements, and cost optimization.

### Payments: Stripe

- Starting with monthly subscriptions
- Usage-based pricing considered for future
- Generous usage limits in subscription tiers

### Deployment: Vercel

- Optimal for Next.js
- Automatic CI/CD
- Edge network
- Preview deployments

### Testing: Playwright

E2E testing framework for automation.

### Monorepo Tooling

- **pnpm workspaces** - Package management and workspace linking
- **Turborepo** - Build caching and task orchestration

```
nexus/
├── apps/
│   └── web/              # Next.js application
├── packages/             # Shared code (when needed)
└── infra/
    └── terraform/        # AWS infrastructure
```

### Infrastructure as Code: Terraform

- **Terraform** for AWS resource management
- S3 buckets with lifecycle policies
- IAM roles and policies
- Keeps infrastructure version-controlled and reproducible

> [!note] Why Terraform?
> Chosen over CDK for cloud-agnostic flexibility and industry-standard tooling.

### Styling: Tailwind CSS

Utility-first CSS framework for rapid UI development.

### File Upload: Chunked

Chunked upload approach for reliability with large files. Core feature requiring polish - different strategies may be needed for different file sizes.

### Storage Strategy: Glacier-First

Default all files to Glacier. Users don't need to know about storage tiers - from their perspective, all files have retrieval time. This simplifies the mental model and maximizes cost savings.

### ORM: Drizzle

Lightweight, TypeScript-native ORM with SQL-like syntax. Chosen for:
- Pure TypeScript (no separate schema language)
- SQL-like queries (AI-friendly, transferable knowledge)
- Lightweight bundle (~50kb vs Prisma's ~2MB)

## Related

- [[principles|Design Principles]]
- [[system-design|System Design]]
- [[architecture/_index|Back to Architecture]]
