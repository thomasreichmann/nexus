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

### Frontend & Backend: Next.js

**Decision:** Full-stack Next.js with App Router

**Frontend:**
- Next.js (latest stable version)
- Server Components for optimal performance
- App Router for improved routing and layouts
- Built-in image optimization
- Streaming and Suspense for better UX
- React Server Actions for seamless data mutations

**Backend:**
- Next.js API Routes / Route Handlers
- Server Actions for form submissions and mutations

**Development:** AI-assisted (Cursor with Claude)

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

## Open Decisions

| Decision | Options | Notes |
|----------|---------|-------|
| ORM | Drizzle vs Prisma | Both viable, need to evaluate DX |
| Styling | Tailwind CSS vs CSS Modules | Tailwind likely |
| File Upload | Chunked vs Simple | Depends on file size limits |

## Related

- [[principles|Design Principles]]
- [[system-design|System Design]]
- [[architecture/_index|Back to Architecture]]
