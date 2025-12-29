---
title: System Design
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - architecture
  - diagram
aliases:
  - Architecture Diagram
  - System Architecture
---

# System Design

Architecture diagrams and data flow for the Nexus MVP.

## High-Level Architecture

```
User Browser
     │
     ▼
Next.js Frontend (React Server Components + Client Components)
     │
     ▼
Next.js API Routes / Server Actions
     │
     ├──► Supabase (Postgres + Auth + Real-time)
     │
     └──► AWS S3 Storage
           ├──► S3 Standard (frequently accessed files)
           └──► S3 Glacier Deep Archive (cold storage)

Stripe ◄── Payment Processing

Deployment: Vercel Edge Network
```

## Repository Structure

Monorepo managed with pnpm workspaces + Turborepo:

```
nexus/
├── package.json           # Root package.json
├── pnpm-workspace.yaml    # Workspace configuration
├── turbo.json             # Turborepo task config
├── apps/
│   └── web/               # Next.js application
│       ├── app/           # App Router pages
│       ├── components/    # React components
│       ├── lib/           # Utilities (supabase, s3)
│       ├── actions/       # Server Actions
│       └── types/         # TypeScript types
├── packages/              # Shared packages (when needed)
└── infra/
    └── terraform/         # AWS infrastructure (S3, IAM)
```

## Data Flow

### File Upload Flow

1. User selects file in browser
2. Client component initiates upload
3. Server Action or API Route receives file
4. File uploaded to S3 Standard tier
5. Metadata stored in Supabase
6. User notified of success

### File Retrieval Flow (Cold Storage)

1. User requests archived file
2. System checks S3 storage tier
3. If Glacier: initiate restore request
4. Notify user of retrieval time (hours)
5. Once restored: generate download URL
6. User downloads file

## Key Next.js Features

1. **Server Components** - Reduce client-side JavaScript, improve performance
2. **Route Handlers** - Modern API routes with full TypeScript support
3. **Server Actions** - Direct server mutations without API routes
4. **Streaming** - Progressive UI rendering for better perceived performance
5. **Image Optimization** - Automatic image optimization and lazy loading
6. **Middleware** - Edge middleware for auth and routing logic
7. **ISR** - Incremental Static Regeneration for cached dashboard pages

## Open Questions

- Exact S3 tier transition logic and timing
- File upload chunking and resumability strategy
- Caching strategy for frequently accessed files
- Edge Functions for specific operations
- Real-time notification implementation
- Row-level security strategy in Supabase
- File encryption approach (at rest and in transit)

## Related

- [[tech-stack|Tech Stack]]
- [[principles|Design Principles]]
- [[architecture/_index|Back to Architecture]]
