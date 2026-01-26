---
title: AI Changelog
created: 2025-12-29
updated: 2026-01-23
status: active
tags:
    - ai
    - changelog
    - meta
aliases:
    - AI Changes
    - Session Log
ai_summary: 'Recent AI changes - READ THIS FIRST for context'
---

# AI Changelog

Recent changes made by AI assistants. **Read this first** to understand recent context.

---

## 2026-01-26

### Session: Source Map Stack Traces (#71)

Added source map transformation for error stack traces in development, making logs show original TypeScript source locations instead of bundled file paths.

**Files Modified:**

- `server/lib/logger.ts` - Added `transformStackTrace()`, `parseStackFrame()`, `formatStackFrame()`, enabled Node.js source map support via `setSourceMapsSupport()`
- `server/trpc/middleware/logging.ts` - Updated `formatError()` and `formatErrorCause()` to apply stack trace transformation
- `server/lib/logger.test.ts` - Unit tests for stack frame parsing/formatting

**Key Pattern:**

```typescript
import { transformStackTrace } from '@/server/lib/logger';

// In formatError:
if (errorVerbosity === 'full') {
    formatted.stack = transformStackTrace(error.stack);
}
```

The `transformStackTrace()` function:

1. Parses each stack frame line using regex
2. Looks up source maps via Node.js `findSourceMap()` API
3. Maps bundled locations back to original source locations
4. Falls back to original line if no source map found

**Note:** Only active in development mode (`isDev`). Production stack traces are unchanged.

---

## 2026-01-25

### Session: Configurable Error Verbosity (#30)

Added configurable error verbosity levels to structured logging, allowing different levels of error detail based on environment.

**Files Modified:**

- `server/lib/logger.ts` - Added `ErrorVerbosity` type and `errorVerbosity` config, exported `isDev`
- `server/trpc/middleware/logging.ts` - Added `FormattedError` interface and `formatError()` function, updated `WideEvent` and `emitEvent`
- `server/trpc/init.ts` - Updated to pass full `TRPCError` to `emitEvent`

**Verbosity Levels:**

| Level      | Fields                               | Default     |
| ---------- | ------------------------------------ | ----------- |
| `minimal`  | code only                            | -           |
| `standard` | code + message                       | Production  |
| `full`     | code + message + stack + cause chain | Development |

**Key Pattern:**

```typescript
import { errorVerbosity, formatError } from '@/server/lib/logger';

// In emitEvent:
if (error) {
    event.error = formatError(error);
}
```

The `formatError()` function formats a `TRPCError` based on the current verbosity level. For `full` verbosity, it recursively formats the cause chain (with depth limit of 5).

---

## 2026-01-24

### Session: Client-Side Logging with pino/browser (#9)

Implemented client-side logging using `pino/browser` that pipes logs to the dev server terminal.

**New Files:**

- `lib/logger/client.ts` - Client-side pino logger with browser transmit API
- `lib/logger/index.ts` - Unified export for cleaner imports
- `app/api/dev-log/route.ts` - Dev-only endpoint to receive client logs
- `app/api/dev-log/route.test.ts` - Unit tests for the endpoint

**Key Pattern:**

Client logs are sent via POST to `/api/dev-log` in development only. The endpoint uses `logger.child({ source: 'client' })` to prefix logs with `[client]`. Same API as server: `log.info()`, `log.error()`, etc.

**SSR Fix:**

Added `enabled: typeof window !== 'undefined'` to disable the client logger during SSR. Without this, logs would appear twice (raw JSON from SSR + formatted from client hydration).

**Usage:**

```typescript
import { log } from '@/lib/logger';

log.info('button clicked');
log.error({ err }, 'failed to load');
```

**Documentation:** See `docs/guides/logging.md` for full details on the dual-logger architecture.

---

### Session: Domain Errors with tRPC Middleware (#35)

Implemented domain error classes and tRPC middleware for automatic error mapping.

**New Files:**

- `server/errors.ts` - Domain error classes (`NotFoundError`, `ForbiddenError`, `InvalidStateError`, `QuotaExceededError`)
- `server/errors.test.ts` - Unit tests for error classes
- `server/trpc/middleware/errorHandler.test.ts` - Integration tests for middleware
- `server/trpc/routers/files.ts` - Example router demonstrating usage

**Key Pattern:**

Services throw domain errors (e.g., `throw new NotFoundError('File', id)`), and the error handler middleware in `init.ts` catches them and converts to appropriate `TRPCError` codes. This keeps business logic decoupled from the API layer.

**tRPC v11 Note:**

In tRPC v11, errors are wrapped in result objects rather than thrown. The middleware checks `result.error.cause` (not try/catch) to detect DomainErrors.

---

### Session: CI Pipeline with GitHub Actions (#13)

Added GitHub Actions CI workflow for code quality checks on PRs and pushes to main.

**Files Created:**

- `.github/workflows/ci.yml` - CI workflow with two jobs

**Workflow Structure:**

| Job         | Steps                                     |
| ----------- | ----------------------------------------- |
| ci          | Lint, Typecheck, Unit tests               |
| smoke-tests | Playwright smoke tests (runs in parallel) |

**Key Features:**

- Reads Node version from `.nvmrc` (currently Node 24)
- Uses pnpm caching via `actions/setup-node`
- Installs only Chromium for smoke tests (faster than all browsers)
- Keeps existing `pr-check.yml` for issue reference validation

**Post-merge TODO:**

- Enable branch protection rule requiring CI checks to pass

---

### Session: Migrate Commands to Skills Format (#58)

Migrated custom slash commands from legacy `.claude/commands/` to the modern `.claude/skills/` format.

**Key Changes:**

| Before                  | After                          |
| ----------------------- | ------------------------------ |
| `.claude/commands/*.md` | `.claude/skills/*/SKILL.md`    |
| Inline agent prompts    | Extracted to `.claude/agents/` |
| Basic frontmatter       | Full Skills frontmatter        |

**New Features Enabled:**

- `disable-model-invocation: true` - Skills are manual-only (no auto-invocation)
- `context: fork` - Each skill runs in isolated subagent context
- Dynamic context injection via `!`command`` syntax
- Template files for common workflows (PR body, review checklists)

**Extracted Agents:**

- `explore-issue` - Codebase exploration for issue context
- `conventions-review` - Check against project conventions
- `code-quality-review` - Check for over-engineering
- `reuse-review` - Check for duplication/reuse
- `groom-research` - Research for issue grooming

**Why:** The Skills format provides better organization, isolated execution context, and access to new Claude Code features like dynamic context injection and custom subagents.

---

## 2026-01-23

### Session: S3 Bucket Infrastructure Setup (#12)

Created dev environment AWS infrastructure for file storage.

**Resources Created:**

| Resource   | Name/Value                |
| ---------- | ------------------------- |
| S3 Bucket  | `nexus-storage-files-dev` |
| IAM User   | `nexus-app-dev`           |
| IAM Policy | `nexus-s3-access-dev`     |
| Region     | `us-east-1`               |

**Configuration Applied:**

- Public access block (all 4 settings enabled)
- Lifecycle rules: immediate transition to Glacier Deep Archive + abort incomplete multipart after 7 days
- CORS: localhost:_, 127.0.0.1:_, \*.vercel.app

**Files Created:**

- `docs/infra/aws-manual-setup.md` - Documents all AWS resources and commands

**Environment Variables to Add:**

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET=nexus-storage-files-dev`
- `AWS_REGION=us-east-1`

**Why us-east-1:**

Glacier Deep Archive is ~$1/TB/month in us-east-1 vs ~$2/TB in sa-east-1. Since Glacier is async (12-48hr restores), latency is irrelevant. Cost savings are significant at scale.

---

## 2026-01-19

### Session: Server Architecture Documentation

Created comprehensive documentation for database-to-server communication patterns.

**New Documentation:**

- `docs/guides/server-architecture.md` — Full guide covering:
    - Layered pattern (Repository → Service → tRPC)
    - Folder structure conventions
    - Repository layer with explicit return types (TypeScript performance)
    - Domain errors with automatic tRPC mapping
    - Service layer conventions
    - tRPC router conventions
    - When to extract (decision framework)

**Updated Documentation:**

- `docs/ai/conventions.md` — Added quick reference table linking to the full guide

**Issues Updated with Architecture Guidance:**

- #18 `tRPC: File upload with presigned URLs`
- #19 `tRPC: File listing & management`
- #20 `tRPC: Glacier retrieval system`
- #22 `Storage quota enforcement`

**Key Architecture Decisions:**

- Repositories have explicit return types (breaks Drizzle type inference chain for performance)
- Services throw domain errors (`NotFoundError`, `QuotaExceededError`, etc.)
- Domain errors define their own tRPC code via constructor parameter
- Error handler middleware auto-maps domain errors to tRPC errors
- tRPC procedures are thin — validation + delegation only
- Adoption is optional — extract layers as complexity grows

---

## 2026-01-18

### Session: Detailed Subscriptions Schema Issue (#15)

Added complete specifications to issue #15 for the subscriptions table, following the pattern established in #14 and #17.

**Issue Updated:**

- #15 `subscriptions` table - Full Drizzle schema with `plan_tier` and `subscription_status` enums, Stripe integration fields, storage quota tracking

**Key Schema Decisions:**

- One subscription per user (`user_id` unique constraint)
- `stripe_subscription_id` nullable (customer exists before subscription during trial)
- `storage_limit` denormalized for fast quota checks
- `cancel_at_period_end` tracks pending cancellations
- Status enum mirrors Stripe statuses exactly

**Labels Changed:**

- #15: `needs-details` → `ready`

---

### Session: Detailed Schema Issues (#14, #17)

Added complete specifications to database schema issues.

**Issues Updated:**

- #14 `files` table - Full Drizzle schema with enums, columns, indexes, foreign keys
- #17 `retrievals` table - Glacier restore tracking with status/tier enums, timestamps for lifecycle

**Files Modified:**

- `docs/ai/conventions.md` - Documented that authorization is at application layer (tRPC), not database layer. Removed RLS policy references.

**Labels Changed:**

- Both issues: `needs-details` → `ready`

**Clarification:**

We do not use Supabase RLS policies. Authorization is enforced in tRPC procedures since we access the database directly via Drizzle, not through Supabase's Data API.

---

### Session: GitHub Workflow Documentation

Extracted GitHub issue management into dedicated documentation files and slimmed down CLAUDE.md.

**Files Created:**

- `docs/ai/github-workflow.md` - AI-specific guide for issue creation, relationships (sub-issues), and management using CLI/GraphQL
- `docs/guides/github-workflow.md` - Human guide for issue management using GitHub web UI

**Files Modified:**

- `CLAUDE.md` - Slimmed Task Workflow section, now references `docs/ai/github-workflow.md` for details
- `docs/ai/_index.md` - Added link to github-workflow

**Why:**

Issue creation/management is infrequent, so detailed instructions don't belong in the main CLAUDE.md. Moving to dedicated docs keeps CLAUDE.md lean while providing detailed guidance when needed.

**Key Addition - Issue Relationships:**

Documented how to use GitHub's native sub-issue system via GraphQL API:

```bash
# Link child issue to parent
gh api graphql -f query='
mutation {
  addSubIssue(input: {
    issueId: "PARENT_NODE_ID",
    subIssueId: "CHILD_NODE_ID"
  }) { issue { number } }
}'
```

Use sub-issues when:

- Plan mentions "follow-up ticket"
- Feature breaks into phases
- Bug reveals related issues

---

## 2026-01-11

### Session: Pricing Model & Frontend Updates (#11)

Created pricing model based on AWS S3 Glacier Deep Archive costs and competitor research. Updated frontend with real pricing tiers.

**Research Conducted:**

- AWS Glacier Deep Archive costs (~$1/TB storage, $0.0025/GB retrieval)
- Competitor pricing (Google Drive, Dropbox, iCloud at ~$5-6/TB)
- Archival storage alternatives (Backblaze B2, Wasabi)

**Decisions Made:**

| Decision        | Choice                                       |
| --------------- | -------------------------------------------- |
| Tier structure  | 3 fixed tiers (Starter/Pro/Max) + Enterprise |
| Free tier       | No (30-day free trial instead)               |
| Retrieval model | Unlimited (baked into price)                 |
| Annual discount | ~17% (2 months free)                         |

**Final Pricing:**

| Tier       | Storage | Monthly | Per TB | vs Competitors     |
| ---------- | ------- | ------- | ------ | ------------------ |
| Starter    | 1 TB    | $3      | $3.00  | 40% cheaper        |
| Pro        | 5 TB    | $12     | $2.40  | 52% cheaper        |
| Max        | 10 TB   | $20     | $2.00  | 60% cheaper        |
| Enterprise | Custom  | Contact | -      | Usage-based option |

**Files Created:**

- `docs/planning/pricing-model.md` - Full cost breakdown, margin analysis, risk scenarios, tier definitions

**Files Modified:**

- `apps/web/components/landing/pricing.tsx` - Updated from 3 placeholder tiers to 4 real tiers (Starter/Pro/Max/Enterprise), fixed grid to 4-column layout
- `apps/web/components/landing/hero.tsx` - Changed "$1/TB/month" to "up to 60% cheaper", updated savings claim from "90%" to "60%"
- `apps/web/components/landing/features.tsx` - Changed "90% cost savings" to "Up to 60% cheaper", fixed retrieval time from "3-12 hour" to "12-48 hour"

**Why:**

- Original frontend had placeholder pricing that wasn't based on real costs
- Retrieval time was incorrect (Glacier Deep Archive is 12-48h, not 3-12h)
- "90% cheaper" claim wasn't accurate - actual savings vs competitors is 40-60%
- Needed documented pricing model for business planning

**Value Proposition:**

Consumer-friendly interface + archival pricing = unique market position. No other service offers Glacier-level pricing with a consumer UX.

---

### Session: Structured Logging with Pino (#8)

Implemented structured logging using Pino with a "wide events" approach - one comprehensive log event per tRPC request.

**Files Created:**

- `apps/web/server/lib/logger.ts` - Base Pino logger with pino-pretty in dev, JSON in prod
- `apps/web/server/trpc/middleware/logging.ts` - Request logging utilities with timing APIs

**Files Modified:**

- `apps/web/server/trpc/init.ts` - Added logging middleware to all procedures, extended context with `requestId` and `log`
- `apps/web/eslint.config.mjs` - Added import restriction to ban direct pino imports in routers
- `apps/web/package.json` - Added pino and pino-pretty dependencies

**Wide Event Structure:**

```typescript
{
  requestId: string,    // UUID per request
  path: string,         // e.g., "auth.me"
  type: "query" | "mutation",
  userId?: string,      // If authenticated
  durationMs: number,
  timings?: { db?: number, s3?: number, ... },
  ok: boolean,
  errorCode?: string,   // UNAUTHORIZED, NOT_FOUND, etc.
  ...customFields       // Added via ctx.log.setField()
}
```

**API Available in Procedures:**

- `ctx.requestId` - UUID for correlation
- `ctx.log.setField(key, value)` - Add custom fields to event
- `ctx.log.timed(label, fn)` - Time an async operation
- `ctx.log.time(label)` / `ctx.log.timeEnd(label)` - Manual timing

**Why:**

- Single comprehensive event per request instead of scattered log statements
- Correlation IDs for request tracing
- Section timing for debugging slow operations
- ESLint rule ensures consistent use of `ctx.log` over direct pino imports

---

## 2026-01-10

### Session: User-Facing Messaging Revision (#7)

Removed technical jargon (AWS, Glacier, S3) and single-competitor comparisons (Dropbox) from all user-facing content.

**Files Modified:**

- `apps/web/components/landing/hero.tsx` - Replaced "AWS Glacier" with "Enterprise-grade durability", "90% cheaper than Dropbox" with "90% cheaper than traditional cloud storage", "No AWS expertise needed" with "No technical setup required"
- `apps/web/components/landing/problem-solution.tsx` - Changed "Glacier is complex" to "Archival storage is complex", "paying Dropbox prices" to "paying premium prices"
- `apps/web/components/landing/how-it-works.tsx` - Replaced "stored in AWS Glacier" with "stored in cold storage"
- `apps/web/components/landing/features.tsx` - Changed "No AWS knowledge needed" to "No technical setup"
- `apps/web/app/layout.tsx` - Updated meta description to remove "AWS complexity"
- `apps/web/app/design/page.tsx` - Changed "Glacier Deep Archive" to "cold storage"
- `docs/ai/context.md` - Updated internal docs for consistency: "AWS S3 Glacier" → "cold/archival storage", "Dropbox for archival" → "cloud storage for archival", "Glacier is cheap but complex" → "Archival storage is cheap but complex"

**Why:**

End users don't need to know our backend infrastructure. Technical terms like AWS/Glacier are meaningless to our target audience and narrowly position us. Similarly, comparing to Dropbox specifically forces a single competitor comparison when users may be coming from Google Drive, OneDrive, iCloud, etc.

**Preserved:**

- Retrieval time messaging (3-12 hours) - important for setting user expectations
- 11 nines durability claim - communicates reliability without mentioning AWS

---

### Session: Frontend Error Handling Patterns (#10)

Documented error handling strategy for the frontend and created implementation issue.

**Files Modified:**

- `docs/ai/conventions.md` - Expanded Error Handling section with layered strategy, tRPC error handling, error boundaries, and form error handling patterns

**Why:**

Needed to establish consistent error handling patterns before implementing features. Documented the decisions:

- Global tRPC error link with Sonner toasts + per-component override via `skipToast`
- Next.js error boundaries (error.tsx, global-error.tsx)
- TanStack Form + Zod for inline validation, toasts for submission errors

**Implementation:** Tracked in GitHub issue #10

---

### Session: README Documentation Links (#6)

Updated README to use proper markdown hyperlinks for documentation instead of plain text file paths.

**Files Modified:**

- `README.md` - Documentation section now has clickable links to all doc sections in a table format

**Why:**

Issue #6 identified that docs references like `docs/ai/conventions.md` weren't clickable. Chose relative links (simplest approach) over GitHub Wiki or Pages. Links work directly in GitHub's markdown renderer.

---

### Session: v0 Dashboard & Landing Page Review (#5)

Reviewed v0-generated dashboard and landing pages. Extracted shared components to reduce duplication.

**Files Created:**

- `apps/web/lib/dashboard/navigation.ts` - Shared dashboard navigation constant
- `apps/web/components/landing/Logo.tsx` - Shared logo component

**Files Modified:**

- `apps/web/components/dashboard/sidebar.tsx` - Now imports `dashboardNavigation` from shared constant
- `apps/web/components/dashboard/header.tsx` - Now imports `dashboardNavigation` from shared constant
- `apps/web/components/landing/header.tsx` - Now uses `<Logo />` component
- `apps/web/components/landing/footer.tsx` - Now uses `<Logo />` component

**Findings:**

- Dashboard routes: Clean structure, no duplicates
- Dashboard components: All follow conventions (function declarations, PascalCase)
- Landing page: All 9 components follow conventions
- Smoke tests: Already exist for all pages, all passing

**Why:**

Navigation arrays were duplicated in sidebar and header. Logo markup was duplicated in landing header and footer. Extracted to shared modules following the promotion rule in conventions.md.

---

## 2026-01-04

### Session: Merge v0 Root Layout into Existing App Layout

Merged v0-generated root layout bits into the existing Next.js root layout, keeping existing providers and font setup as the source of truth.

**Files Modified:**

- `apps/web/app/layout.tsx` - Updated metadata (title/description), added Vercel Analytics, ensured `font-sans` is applied while retaining Geist font variables + providers
- `apps/web/app/(auth)/layout.tsx` - Fixed `Link` to use `next/link`, updated children typing to `ReactNode`
- `apps/web/app/(dashboard)/layout.tsx` - Updated children typing to `ReactNode` and aligned import/style

**Why:**

v0 output contained useful marketing metadata + Analytics, but our existing root layout already wires up Theme + tRPC + font variables. This keeps the existing app structure intact while adopting the safe additions.

### Session: E2E Smoke Tests for v0 Imports

Added Playwright smoke tests to catch render errors from v0-imported components.

**Files Created:**

- `apps/web/e2e/utils.ts` - Shared test utilities (`setupConsoleErrorTracking`)
- `apps/web/e2e/smoke/home.spec.ts` - Landing page smoke test
- `apps/web/e2e/smoke/auth.spec.ts` - Sign-in and sign-up page smoke tests
- `apps/web/e2e/smoke/dashboard.spec.ts` - Dashboard, files, upload, settings page smoke tests

**Files Modified:**

- `apps/web/package.json` - Added `test:e2e:smoke` script for running only smoke tests
- `apps/web/components/dashboard/upload-zone.tsx` - Added `nativeButton={false}` to fix Base UI warning
- `apps/web/components/dashboard/header.tsx` - Replaced `Button` with `render={<Link>}` pattern with direct `Link` + `buttonVariants()` to fix hydration mismatch
- `docs/ai/conventions.md` - Added Testing section with smoke test guidelines
- `CLAUDE.md` - Added instruction to run smoke tests after modifying pages/components

**Issues Caught & Fixed:**

1. **Upload page**: Button with `render={<span />}` needed `nativeButton={false}`
2. **Header**: Button with `render={<Link />}` caused hydration mismatch (type/role attributes differ between SSR and client)

**Why:**

When importing UI from v0, components often have subtle SSR/hydration issues that only surface at render time. Smoke tests that check for console errors catch these before production.

**Test Structure:**

```
e2e/
├── smoke/           # Fast render tests (~2s) - run after changes
│   ├── home.spec.ts
│   ├── auth.spec.ts
│   └── dashboard.spec.ts
└── utils.ts         # Shared utilities
```

- `pnpm -F web test:e2e:smoke` - smoke tests only (fast, run after changes)
- `pnpm -F web test:e2e` - all E2E tests (smoke + future interaction tests)

---

### Session: Radix UI to Base UI Migration

Migrated all shadcn/ui components from Radix UI primitives to Base UI primitives using basecn (https://basecn.dev).

**Why:**

- Tech stack decision was to use "shadcn/ui with Base UI primitives"
- Initial components from v0 CLI import used Radix UI (default shadcn)
- Base UI is the newer headless component library from the MUI team

**Components Migrated:**

All 10 UI components converted via basecn CLI:

- `button.tsx` - Now uses `@base-ui/react/button`
- `badge.tsx` - Uses native HTML with render prop pattern
- `card.tsx` - Pure HTML (no primitives)
- `input.tsx` - Uses `@base-ui/react/input`
- `label.tsx` - Uses `@base-ui/react/field`
- `table.tsx` - Pure HTML (no primitives)
- `checkbox.tsx` - Now uses `@base-ui/react/checkbox`
- `progress.tsx` - Now uses `@base-ui/react/progress`
- `dropdown-menu.tsx` - Now uses `@base-ui/react/menu`
- `sheet.tsx` - Now uses `@base-ui/react/dialog`

**Key API Changes:**

| Radix UI               | Base UI                                          |
| ---------------------- | ------------------------------------------------ |
| `asChild` prop         | `render` prop                                    |
| `DropdownMenuContent`  | `DropdownMenuPositioner` + `DropdownMenuContent` |
| `data-[state=checked]` | `data-[checked]`                                 |
| `data-[state=open]`    | `data-[open]`                                    |

**Gotchas:**

- Base UI `Button` defaults to rendering a native `<button>`. If you pass a non-`<button>` element to `render` (e.g. Next.js `Link`), set `nativeButton={false}` to avoid the dev warning.

**Files Modified (Consumer Code):**

Updated all files using `asChild` to use `render` prop:

- `components/dashboard/file-browser.tsx` - DropdownMenu + Checkbox
- `components/dashboard/header.tsx` - Sheet + DropdownMenu + Button
- `components/dashboard/upload-zone.tsx` - Button
- `components/landing/header.tsx` - Button
- `components/landing/hero.tsx` - Button
- `components/landing/cta.tsx` - Button
- `components/landing/pricing.tsx` - Button
- `app/(dashboard)/dashboard/page.tsx` - Button

**Dependencies:**

Added:

- `@base-ui/react`

Removed:

- `@radix-ui/react-checkbox`
- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-label`
- `@radix-ui/react-progress`
- `@radix-ui/react-slot`

**Notes:**

- Migration guide from basecn.dev: https://basecn.dev/docs/get-started/migrating-from-radix-ui
- DropdownMenu now requires `DropdownMenuPositioner` wrapper with `align`/`side` props
- **Important:** The `render` prop doesn't work with Next.js static page generation. For static pages (server components), use traditional pattern: `<Link href="/foo"><Button>Text</Button></Link>`. The `render` prop works in client components ("use client").

---

## 2026-01-03

### Session: BetterAuth Setup

Replaced Supabase Auth with BetterAuth for unified Drizzle + tRPC architecture.

**Decisions Made:**

- **Fresh user table** - Let BetterAuth create its own tables (user, session, account, verification)
- **Email/password only** - OAuth providers to be added later
- **Skip email sending** - No password reset or email verification for now

**Files Created:**

- `apps/web/lib/auth.ts` - BetterAuth server config with Drizzle adapter
- `apps/web/lib/auth-client.ts` - Client-side auth hooks (signIn, signUp, signOut, useSession)
- `apps/web/app/api/auth/[...all]/route.ts` - Auth API handler
- `apps/web/app/(auth)/login/page.tsx` - Login page with route group
- `apps/web/app/(auth)/signup/page.tsx` - Signup page with route group
- `apps/web/app/sign-out-button.tsx` - Sign out with React Query cache invalidation
- `apps/web/app/user-info-client.tsx` - Client-side user info via tRPC

**Files Modified:**

- `apps/web/server/db/schema.ts` - BetterAuth tables (user, session, account, verification)
- `apps/web/server/trpc/init.ts` - Added session to context, added `protectedProcedure`
- `apps/web/server/trpc/router.ts` - Added auth router
- `apps/web/server/trpc/routers/auth.ts` - Created `me` procedure
- `apps/web/app/page.tsx` - Homepage showing server (RSC) and client (tRPC) auth status
- `apps/web/lib/env/schema.ts` - Added `BETTER_AUTH_SECRET`, removed Supabase auth keys

**Why BetterAuth over Supabase Auth:**

1. Application-layer auth that integrates cleanly with Drizzle ORM
2. Session stored in our database (not Supabase-managed)
3. Direct function calls for server-side auth (no HTTP self-calls)
4. Clean integration with tRPC context for procedure gating

**Key Patterns:**

```typescript
// Server-side session check (RSC)
const session = await auth.api.getSession({ headers: await headers() });

// tRPC context (session available in all procedures)
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return next({ ctx: { ...ctx, session: ctx.session } });
});

// Client-side auth
await authClient.signIn.email({ email, password });
await authClient.signOut({
    fetchOptions: { onSuccess: () => queryClient.invalidateQueries() },
});
```

**Notes:**

- BetterAuth client functions make HTTP POST requests to `/api/auth/*`
- `auth.api.getSession()` is a direct function call (not HTTP)
- React Query cache must be invalidated on sign out for client components

### Session: `lib/` Organization (Auth + `cn`)

Reorganized `apps/web/lib/` to use domain folders and concept modules, and documented the pattern for future additions.

**Changes:**

- Moved auth modules:
    - `apps/web/lib/auth.ts` → `apps/web/lib/auth/server.ts`
    - `apps/web/lib/auth-client.ts` → `apps/web/lib/auth/client.ts`
- Extracted `cn` helper:
    - `apps/web/lib/utils.ts` → `apps/web/lib/cn.ts`
    - `apps/web/lib/utils.test.ts` → `apps/web/lib/cn.test.ts`
- Updated imports to the new paths:
    - Server code now imports `auth` from `@/lib/auth/server`
    - Client code now imports `authClient` from `@/lib/auth/client`
- Updated shadcn alias:
    - `apps/web/components.json` `aliases.utils` now points at `@/lib/cn`

**Why:**

- Keep `lib/` scalable (domain folders + cohesive concept files)
- Make server/client intent obvious for auth
- Avoid `utils.ts` becoming a catch-all over time

---

## 2025-12-30

### Session: Supabase New API Keys

Updated env var names to match Supabase's new API key system.

**Changes:**

| Old Name                        | New Name                               |
| ------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY`     | `SUPABASE_SECRET_KEY`                  |

**Files Modified:**

- `apps/web/lib/env/` - Updated schema
- `apps/web/.env.example` - Updated template
- `turbo.json` - Updated env var references
- `docs/guides/environment-setup.md` - Updated docs with new key names

**Why:** Supabase introduced new `sb_publishable_...` and `sb_secret_...` keys to replace JWT-based anon/service_role keys. New projects only have the new keys.

---

### Session: Drizzle ORM Setup & Database Workflow

Added Drizzle ORM and defined the database workflow for AI-assisted development.

**Decisions Made:**

- **Migrations over push** - Use `db:generate` + `db:migrate` for all changes (not `db:push`)
- **Single environment** - Local dev uses cloud Supabase (no local Docker)
- **Custom migrations** - Use `db:custom <name>` for RLS policies, functions, triggers
- **AI rules** - Never manually create migration files, always use drizzle-kit

**Packages Added:**

- `drizzle-orm` - ORM with type-safe queries
- `postgres` - Postgres.js driver
- `dotenv` - Env loading for drizzle-kit CLI
- `drizzle-kit` (dev) - Migrations and studio

**Files Created:**

- `apps/web/drizzle.config.ts` - Drizzle config with dotenv for CLI commands
- `apps/web/server/db/schema.ts` - Initial schema with users table
- `apps/web/server/db/index.ts` - Database client export
- `docs/guides/database-workflow.md` - Full migration workflow documentation

**Files Modified:**

- `apps/web/package.json` - Added db:generate, db:migrate, db:push, db:studio, db:custom, typecheck scripts
- `docs/ai/conventions.md` - Added Database (Drizzle) section with AI rules
- `docs/guides/environment-setup.md` - Clarified single-env (cloud-only) approach

**Why migrations over push:**

1. Git history of all schema changes
2. Can include RLS policies, functions, triggers in migrations
3. Reproducible across environments
4. Safer - review SQL before applying

**Migration workflow:**

```bash
# Schema changes
pnpm -F web db:generate
pnpm -F web db:migrate

# RLS/functions
pnpm -F web db:custom add-rls-policies
# Edit the SQL file
pnpm -F web db:migrate
```

---

### Session: Environment Setup & Type-Safe Configuration

Added environment variable management strategy with type-safe validation.

**Decisions Made:**

- **Env file location:** `apps/web/` (Next.js auto-loads)
- **Source of truth:** Vercel dashboard, pulled via `pnpm env:pull`
- **Type safety:** Manual Zod validation in `lib/env/schema.ts`
- **Database access:** Both Drizzle (direct Postgres) and Supabase client

**Files Created:**

- `docs/guides/environment-setup.md` - Full environment documentation
- `apps/web/.env.example` - Template with all 13 env vars
- `apps/web/lib/env/` - Zod validation & typed exports

**Files Modified:**

- `docs/planning/bootstrap.md` - Added step 3.2 for environment setup
- `docs/ai/context.md` - Updated env vars section, added DATABASE_URL
- `package.json` - Added `env:pull` script

**Why:** Environment setup was missing from bootstrap guide. Added type-safe validation to fail fast on missing vars and provide TypeScript autocomplete.

**Notes:**

- Use `vercel link` first (one-time), then `pnpm env:pull`
- Server vars validated separately from client (NEXT*PUBLIC*) vars
- DATABASE_URL needed for Drizzle direct Postgres access

---

## 2025-12-29

### Session: Supporting Libraries & Final Tech Decisions

Completed all technical decisions for the MVP stack.

**Decisions Made:**

- **Next.js 16** - Updated from 15, with `proxy.ts`, `"use cache"`, Turbopack, React 19.2
- **API Layer:** tRPC v11 with new TanStack Query v5 integration
- **UI:** shadcn/ui (Base UI), Lucide icons, Sonner toasts
- **Forms:** TanStack Form + Zod validation
- **Testing:** Vitest + @testing-library/react (unit), Playwright (E2E)
- **Linting:** ESLint + Prettier
- **Utilities:** date-fns, superjson
- **Glacier-first storage** - All files go to Glacier by default

**Files Modified:**

- `docs/architecture/tech-stack.md` - Added Supporting Libraries section, updated Testing
- `docs/ai/context.md` - Added all library decisions, updated file locations for tRPC
- `docs/guides/nextjs-patterns.md` - Updated for Next.js 16 (`proxy.ts`, `"use cache"`)
- `CLAUDE.md` - Updated stack to Next.js 16, added key decisions

**Why:** Final review of all technical choices before starting implementation. Chose tools that work well together (TanStack ecosystem, shadcn + Tailwind, Drizzle + Zod).

---

### Session: Monorepo & Infrastructure Decisions

Documented monorepo structure and infrastructure-as-code decisions.

**Decisions Made:**

- **Monorepo tooling:** pnpm workspaces + Turborepo
- **IaC:** Terraform (over CDK, for cloud-agnostic flexibility)
- **Structure:** `apps/web/` for Next.js, `infra/terraform/` for AWS
- **Shared packages:** Add `packages/` when needed, not upfront

**Files Modified:**

- `docs/architecture/tech-stack.md` - Added Monorepo Tooling and Terraform sections
- `docs/architecture/system-design.md` - Added Repository Structure section
- `docs/ai/context.md` - Updated file paths to `apps/web/` prefix, added IaC to decisions

**Why:** Finalizing architecture decisions before building. Terraform chosen after consulting with someone with more devops experience.

---

### Session: AI Documentation Simplification

Removed overly prescriptive rules and undefined patterns from AI documentation.

**Files Modified:**

- `CLAUDE.md` - Removed Do's/Don'ts lists, removed app directory structure
- `.cursorrules` - Removed patterns section and avoid section, simplified
- `docs/ai/patterns.md` - Removed all code examples, marked as draft
- `docs/ai/conventions.md` - Removed app directory structure and Server/Client Component patterns

**Why:** User feedback that defining hard rules limits AI creativity and can cause over-focus on don'ts. App structure isn't finalized, so specific patterns shouldn't be defined yet.

**Notes:**

- Keep general code quality guidelines (TypeScript, naming, error handling)
- Remove specific architecture that isn't decided yet
- Patterns will be added as they emerge during development

---

### Session: AI Documentation Setup

Created AI-friendly documentation structure for Claude Code and Cursor.

**Files Created:**

- `docs/ai/_index.md` - AI docs hub
- `docs/ai/context.md` - Project background and architecture
- `docs/ai/conventions.md` - Naming and style rules
- `docs/ai/patterns.md` - Code pattern templates
- `docs/ai/changelog.md` - This file
- `CLAUDE.md` - Root context for Claude Code
- `.cursorrules` - Root context for Cursor

**Why:** Enable AI assistants to understand the project instantly and generate consistent code.

**Notes:**

- All AI docs use `ai_summary` frontmatter for quick parsing
- Patterns are copy-paste ready templates
- Check `conventions.md` before generating code

---

### Session: Obsidian Enhancement

Added Canvas and Excalidraw support for visual documentation.

**Files Created:**

- `docs/architecture/system-overview.canvas` - Interactive architecture board
- `docs/architecture/drawings/` - Folder for Excalidraw diagrams

**Files Modified:**

- `docs/.obsidian/community-plugins.json` - Added excalidraw plugin
- `docs/architecture/_index.md` - Added Visual Tools section
- `docs/contributing.md` - Added Canvas/Excalidraw instructions

**Notes:**

- Canvas is for high-level architecture boards
- Excalidraw is for detailed hand-drawn diagrams
- Excalidraw files saved to `architecture/drawings/`

---

### Session: Documentation Vault Improvements

Added ADRs, dev journal, and additional templates.

**Files Created:**

- `docs/decisions/_index.md` - ADR index
- `docs/journal/_index.md` - Dev journal index
- `docs/templates/adr-template.md` - Architecture Decision Record template
- `docs/templates/meeting-notes-template.md` - Meeting notes template
- `docs/templates/feature-spec-template.md` - Feature specification template
- `docs/templates/daily-note-template.md` - Daily dev note template
- `docs/changelog.md` - Project changelog
- `docs/contributing.md` - Contribution guidelines

**Notes:**

- ADRs use numbered format: `001-decision-name.md`
- Daily notes configured for Templater plugin
- All templates use Templater syntax

---

### Session: Notion to Obsidian Migration

Migrated all documentation from Notion to Obsidian vault.

**Structure Created:**

```
docs/
├── index.md                # Main hub
├── architecture/           # System design
│   ├── tech-stack.md
│   ├── principles.md
│   └── system-design.md
├── guides/                 # How-to docs
│   ├── getting-started.md
│   └── nextjs-patterns.md
├── planning/               # Roadmap, planning
│   ├── mvp-notes.md
│   └── roadmap.md
└── resources/              # External links
    └── references.md
```

**Features Implemented:**

- YAML frontmatter on all docs
- Obsidian callouts (> [!note], etc.)
- Wikilinks for internal navigation
- Dataview queries for dynamic content
- Tags: #architecture, #guide, #planning, etc.

**Plugins Configured:**

- Dataview (required for queries)
- Templater (for templates)

**Notes:**

- Task tracking removed per user preference
- Emojis removed from filenames
- POC status preserved in prose

---

## How to Update This File

After completing significant work:

1. Add new entry under today's date (or create new date heading)
2. Use format: `### Session: Brief Description`
3. List files created/modified
4. Explain **WHY**, not just what
5. Add **Notes** for gotchas or context

Example:

```markdown
### Session: Auth Implementation

- Created `lib/auth/session.ts`
- Updated `middleware.ts`
- **Note:** Using Supabase auth helpers, not custom JWT
```
