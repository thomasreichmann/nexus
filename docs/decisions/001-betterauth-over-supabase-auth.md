---
title: 'ADR-001: BetterAuth over Supabase Auth'
created: 2026-01-03
updated: 2026-01-03
status: accepted
tags:
    - decisions
    - adr
    - auth
    - betterauth
aliases:
    - Auth Decision
---

# ADR-001: BetterAuth over Supabase Auth

## Status

**Accepted**

## Context

Nexus uses Supabase as its PostgreSQL database provider. The initial assumption was to also use Supabase Auth for authentication, keeping everything within the Supabase ecosystem. However, we're also using Drizzle ORM for database access and tRPC for API routes, which creates an architectural tension.

Supabase Auth manages its own user/session tables and requires using the Supabase client for auth operations. This creates two separate data access patterns: Drizzle for application data and Supabase client for auth data.

## Decision Drivers

- **Unified data layer** - Want all database access through Drizzle ORM
- **tRPC integration** - Need session data available in tRPC context for procedure gating
- **Simplicity** - Prefer application-layer auth we fully control
- **Type safety** - Want auth tables in our Drizzle schema for type-safe queries

## Considered Options

### Option 1: Supabase Auth

Use Supabase's built-in authentication with their JS client.

**Pros:**

- Zero setup - comes with Supabase project
- Managed infrastructure (email sending, OAuth providers)
- Real-time auth state via Supabase client

**Cons:**

- Separate data access pattern from Drizzle
- Session stored in Supabase, not our schema
- Requires Supabase client for auth operations
- Less control over auth tables and logic

### Option 2: BetterAuth

Application-layer auth library with Drizzle adapter.

**Pros:**

- Auth tables in our Drizzle schema (user, session, account, verification)
- Direct function calls for server-side auth (`auth.api.getSession()`)
- Clean tRPC integration via context
- Full control over auth logic and session management
- No additional client library needed

**Cons:**

- Must set up email sending separately (Resend, etc.)
- Must configure OAuth providers manually
- Newer library, smaller community

### Option 3: NextAuth.js / Auth.js

The most popular auth library for Next.js.

**Pros:**

- Large community and ecosystem
- Many OAuth provider adapters
- Well-documented

**Cons:**

- Complex configuration
- Session handling can be opaque
- Drizzle adapter exists but less native than BetterAuth

## Decision

Use **BetterAuth** with Drizzle adapter for authentication.

Key implementation details:

- `lib/auth.ts` - Server config with Drizzle adapter
- `lib/auth-client.ts` - Client hooks (signIn, signUp, signOut)
- `app/api/auth/[...all]/route.ts` - API handler
- Session available in tRPC context via `auth.api.getSession()`
- `protectedProcedure` for authenticated-only routes

## Consequences

### Positive

- Single data access pattern (all queries through Drizzle)
- Auth tables are part of our schema with full type safety
- Session available in tRPC context for easy procedure gating
- Server-side auth checks are direct function calls (no HTTP overhead)
- Full control over auth flow and session management

### Negative

- Email sending requires separate setup
- OAuth providers require manual configuration
- Smaller community than NextAuth.js

### Risks

- **BetterAuth is newer** - Mitigated by simple API surface and ability to switch if needed
- **No email verification for MVP** - Acceptable for initial launch, will add later

## Related

- [[decisions/_index|Back to ADRs]]
- [[architecture/tech-stack|Tech Stack]]
