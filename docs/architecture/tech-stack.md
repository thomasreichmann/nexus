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
- ESLint + Prettier for linting/formatting

**Development:** AI-assisted (Cursor/Claude Code)

### Database: Supabase

- PostgreSQL database
- Built-in authentication
- Real-time capabilities
- Row-level security

### Storage: AWS S3

- **S3 Glacier Deep Archive** - default for all files (Glacier-first strategy)
- Users don't see storage tiers - all files have retrieval time

### Payments: Stripe

- Starting with monthly subscriptions
- Usage-based pricing considered for future
- Generous usage limits in subscription tiers

### Deployment: Vercel

- Optimal for Next.js
- Automatic CI/CD
- Edge network
- Preview deployments

### Testing

- **Vitest** - Unit testing (with @testing-library/react for components)
- **Playwright** - E2E testing
- **tRPC procedure mocks** - API mocking
- File naming: `*.test.ts` (unit), `*.spec.ts` (E2E)
- Test location: Colocated with source files

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

### ORM: Drizzle

Lightweight, TypeScript-native ORM with SQL-like syntax. Chosen for:
- Pure TypeScript (no separate schema language)
- SQL-like queries (AI-friendly, transferable knowledge)
- Lightweight bundle (~50kb vs Prisma's ~2MB)

## Supporting Libraries

### API Layer

- **tRPC v11** - End-to-end typesafe APIs
- **TanStack Query v5** - Data fetching (via tRPC integration)
- New TanStack-native integration pattern (not classic wrapper)
- `createCaller` for Server Components, hooks for Client Components

### UI & Components

- **shadcn/ui** - Component library (with Base UI primitives)
- **Lucide** - Icon library
- **Sonner** - Toast notifications
- **TanStack Form** - Form handling
- **Zod** - Schema validation (integrates with Drizzle via drizzle-zod)

### Utilities

- **date-fns** - Date formatting and manipulation
- **superjson** - Serialization for tRPC

## Related

- [[principles|Design Principles]]
- [[system-design|System Design]]
- [[architecture/_index|Back to Architecture]]
