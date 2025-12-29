---
title: Getting Started
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - guide
  - setup
  - nextjs
  - supabase
  - aws
aliases:
  - Development Setup
  - Quick Start
---

# Getting Started

Development environment setup guide for the Nexus MVP.

## Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- pnpm or npm package manager
- Git installed
- Cursor editor installed and configured with Claude
- GitHub account (for version control)
- Vercel account (for deployment)
- Supabase account
- AWS account (for S3)
- Stripe account (for payments)

## Step 1: Initialize Next.js Project

```bash
# Create new Next.js project
npx create-next-app@latest nexus-mvp \
  --typescript \
  --tailwind \
  --app \
  --import-alias "@/*"

cd nexus-mvp

# Initialize git (if not done automatically)
git init
git add .
git commit -m "Initial commit: Next.js setup"

# Create GitHub repository and push
gh repo create nexus-mvp --private --source=. --push
```

## Step 2: Set Up Supabase

### Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create new project: "nexus-mvp"
3. Save your project URL and anon key
4. Save your service role key (for server-side)

### Install Supabase Client

```bash
pnpm add @supabase/supabase-js @supabase/auth-helpers-nextjs
```

### Create Supabase Clients

```typescript
// lib/supabase/client.ts (for client components)
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export const createClient = () => createClientComponentClient();

// lib/supabase/server.ts (for server components)
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

export const createServerClient = () => {
  const cookieStore = cookies();
  return createServerComponentClient({ cookies: () => cookieStore });
};
```

## Step 3: Set Up AWS S3

### Create S3 Buckets

1. Log into AWS Console
2. Navigate to S3
3. Create bucket: `nexus-storage-prod`
4. Enable versioning
5. Set up CORS configuration
6. Create IAM user with S3 access
7. Save access key and secret key

### Install AWS SDK

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## Step 4: Configure Environment Variables

Create `.env.local` file:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET=nexus-storage-prod

# Stripe (get these later)
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> [!warning] Security
> Never commit `.env.local` to version control. Ensure it's in `.gitignore`.

## Step 5: Install Core Dependencies

```bash
# Database & ORM (choose one)
pnpm add drizzle-orm
pnpm add -D drizzle-kit
# OR
pnpm add prisma @prisma/client

# Forms & Validation
pnpm add react-hook-form zod @hookform/resolvers

# UI Components
pnpm add @radix-ui/react-dropdown-menu @radix-ui/react-dialog
pnpm add @radix-ui/react-select @radix-ui/react-toast
pnpm add lucide-react

# Utilities
pnpm add class-variance-authority clsx tailwind-merge
pnpm add date-fns
```

## Step 6: Set Up Project Structure

```bash
mkdir -p app/{api,\(auth\),\(dashboard\)}
mkdir -p components/{ui,features}
mkdir -p lib/{supabase,s3,utils}
mkdir -p actions
mkdir -p types
```

## Step 7: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Configure project:
   - Framework Preset: Next.js
   - Root Directory: ./
4. Add environment variables from `.env.local`
5. Deploy

### Configure Vercel CLI (optional)

```bash
pnpm add -g vercel
vercel login
vercel link
```

## Quick Reference

### Useful Commands

```bash
# Development
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm start        # Start production server

# Code Quality
pnpm lint         # Run ESLint
pnpm type-check   # TypeScript check

# Deployment
vercel            # Deploy to Vercel
vercel --prod     # Deploy to production
```

### Important Files

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout |
| `app/page.tsx` | Landing page |
| `middleware.ts` | Auth middleware |
| `next.config.js` | Next.js configuration |
| `.env.local` | Environment variables |

## Next Steps

1. Implement authentication flow
2. Create dashboard layout
3. Build file upload component
4. Implement S3 integration
5. Create file listing page
6. Add Stripe integration

See [[nextjs-patterns|Next.js Patterns]] for detailed implementation guidance.

## Related

- [[nextjs-patterns|Next.js Patterns]]
- [[tech-stack|Tech Stack]]
- [[guides/_index|Back to Guides]]
