---
title: Environment Setup
created: 2025-12-30
updated: 2025-12-30
status: active
tags:
    - guide
    - environment
    - configuration
aliases:
    - Env Setup
    - Environment Variables
---

# Environment Setup

Environment variable management and configuration strategy for Nexus.

## Overview

Nexus uses Vercel as the source of truth for environment variables:

- Variables configured once in Vercel dashboard
- Pulled locally via npm scripts
- Type-safe validation with Zod at runtime
- Clear separation of server vs client variables

## Quick Start

```bash
# Link project to Vercel (first time only)
vercel link

# Pull environment variables
pnpm env:pull
```

This creates `apps/web/.env.local` with all variables from your Vercel Development environment.

## File Structure

```
apps/web/
├── .env.example      # Template for reference (committed)
├── .env.local        # Pulled from Vercel (gitignored)
└── lib/
    └── env.ts        # Type-safe validation
```

## Environment Variables

### Supabase (Client)

Used by Supabase JS client for auth and real-time features.

| Variable | Type | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Service role key (admin access) |

### Database (Drizzle)

Direct PostgreSQL connection for Drizzle ORM queries.

| Variable | Type | Description |
|----------|------|-------------|
| `DATABASE_URL` | Server | PostgreSQL connection string |

> [!note] Connection Pooling
> For production, use the pooled connection string (port 6543) instead of direct connection (port 5432).

### AWS S3

File storage credentials for S3/Glacier operations.

| Variable | Type | Description |
|----------|------|-------------|
| `AWS_ACCESS_KEY_ID` | Server | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | Server | IAM secret key |
| `AWS_REGION` | Server | AWS region (e.g., `us-east-1`) |
| `S3_BUCKET` | Server | S3 bucket name |

### Stripe

Payment processing credentials.

| Variable | Type | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` | Public | Publishable key |
| `STRIPE_SECRET_KEY` | Server | Secret key |
| `STRIPE_WEBHOOK_SECRET` | Server | Webhook signing secret |

### App

Application-level configuration.

| Variable | Type | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_APP_URL` | Public | Base URL of the application |

## Type-Safe Access

All environment variables are validated at startup using Zod. Import from `@/lib/env`:

```typescript
import { env } from '@/lib/env';

// Type-safe, validated at runtime
const bucket = env.S3_BUCKET;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
```

### Benefits

- **Fail fast** - App won't start if required vars are missing
- **TypeScript autocomplete** - Full IntelliSense support
- **Single source of truth** - One place for all env var definitions
- **Server/client separation** - Clear distinction prevents leaking secrets

## Vercel Environment Management

### Initial Setup

1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add all variables for each environment:
   - **Production** - Live site values
   - **Preview** - PR deployment values
   - **Development** - Local development values

### Adding New Variables

1. Add in Vercel dashboard for all environments
2. Pull locally: `pnpm env:pull`
3. Add to `lib/env.ts` schema (server or client)
4. Update `.env.example` for reference
5. Update this documentation

## Related

- [[getting-started|Getting Started]]
- [[tech-stack|Tech Stack]]
- [[guides/_index|Back to Guides]]
