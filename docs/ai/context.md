---
title: Project Context
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - ai
  - context
  - architecture
aliases:
  - Background
  - Project Overview
ai_summary: "Deep background on project goals, architecture, and business logic"
---

# Project Context

Detailed background for AI to understand the Nexus project deeply.

## What is Nexus?

Nexus is a **deep storage solution** that helps users store files cost-effectively using AWS S3's tiered storage:
- **Hot storage** (S3 Standard) - frequently accessed files
- **Cold storage** (S3 Glacier/Deep Archive) - rarely accessed, very cheap

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
- **Next.js 15+** with App Router
- Server Components for performance
- Server Actions for mutations
- Deployed on **Vercel**

### Database
- **Supabase** (PostgreSQL)
- Row-level security for multi-tenancy
- Real-time subscriptions for status updates

### Storage
- **AWS S3** for file storage
- Standard tier → Glacier transition based on access patterns
- Presigned URLs for secure uploads/downloads

### Authentication
- **Supabase Auth**
- Email/password initially
- OAuth providers later

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
2. Client gets presigned URL from API
3. Client uploads directly to S3 (Standard tier)
4. Metadata saved to Supabase
5. User sees file in dashboard

### Retrieval Flow (Cold Storage)
1. User requests file from Glacier
2. System initiates restore (takes 3-12 hours)
3. User notified when ready
4. Presigned download URL generated
5. File available for limited time

### Tier Transition
1. Files not accessed for X days flagged
2. Lifecycle policy moves to Glacier
3. Database updated with new tier
4. User can still request retrieval

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

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Next.js | Full-stack, great DX, Vercel integration |
| Database | Supabase | Postgres + Auth + Realtime in one |
| Storage | AWS S3 | Industry standard, Glacier support |
| Payments | Stripe | Developer-friendly, subscription support |
| Deployment | Vercel | Best Next.js experience |

## Open Decisions

| Question | Options | Leaning |
|----------|---------|---------|
| ORM | Drizzle vs Prisma | Drizzle (lighter) |
| Styling | Tailwind vs CSS Modules | Tailwind |
| Upload strategy | Chunked vs simple | Chunked for large files |

## File Locations

| Concern | Location |
|---------|----------|
| Pages/Routes | `app/` |
| UI Components | `components/ui/` |
| Feature Components | `components/features/` |
| Server Actions | `actions/` |
| Database Queries | `lib/supabase/` |
| S3 Operations | `lib/s3/` |
| Types | `types/` |
| Documentation | `docs/` |

## Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

## Related

- [[patterns|Code Patterns]] - Implementation examples
- [[conventions|Conventions]] - Naming and style
- [[architecture/_index|Architecture Docs]] - Detailed technical docs
- [[ai/_index|Back to AI Docs]]
