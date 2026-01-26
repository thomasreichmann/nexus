---
title: Code Conventions
created: 2025-12-29
updated: 2026-01-03
status: active
tags:
    - ai
    - conventions
    - standards
aliases:
    - Naming Conventions
    - Style Guide
ai_summary: 'Naming, structure, and style rules for consistent code'
---

# Code Conventions

Naming conventions, file structure, and code style rules for the Nexus project.

## File Naming

| Type       | Convention                | Example               |
| ---------- | ------------------------- | --------------------- |
| Components | `PascalCase.tsx`          | `FileUploader.tsx`    |
| Utilities  | `camelCase.ts`            | `formatBytes.ts`      |
| Hooks      | `useCamelCase.ts`         | `useFileUpload.ts`    |
| Actions    | `camelCase.ts`            | `uploadFile.ts`       |
| Types      | `camelCase.ts`            | `fileTypes.ts`        |
| Tests      | `*.test.ts` / `*.spec.ts` | `formatBytes.test.ts` |

## Library (`apps/web/lib/`) Organization

Use `apps/web/lib/` for **shared primitives** and **integration glue** used across the app (auth, env, tRPC, formatting, parsing). Avoid turning it into a generic dumping ground.

**Structure**

- Prefer **domain folders**: `lib/auth/*`, `lib/env/*`, `lib/trpc/*`, `lib/storage/*`, `lib/stripe/*`, etc.
- Within a domain, prefer **concept modules** (one cohesive concept per file), not one function per file:
    - ✅ `lib/storage/tiers.ts` exporting several tier-related helpers
    - ❌ `lib/storage/getTierLabel.ts`, `lib/storage/getTierEta.ts`, ...
- Only split a file when there’s a real boundary (size + separable concerns), not preemptively.

**Client/server intent (when needed)**

- When something is clearly client-only or server-only, encode it in the path/name:
    - `lib/auth/client.ts` vs `lib/auth/server.ts`
    - or `*.client.ts` / `*.server.ts` when that fits better

**Promotion rule (to avoid duplication + file explosion)**

- If a helper is used once, keep it **local** to the feature/component.
- Promote into `lib/<domain>/...` when it's reused (or clearly reusable), and keep a single canonical implementation there.

**Structured namespace exports (for multi-operation modules)**

When a domain module has multiple related operations, export them via a structured namespace object. This provides discoverability via autocomplete and groups related functionality.

```typescript
// lib/storage/index.ts
import * as presigned from './presigned';
import * as glacier from './glacier';
import * as objects from './objects';

export const s3 = {
    presigned,
    glacier,
    objects,
} as const;

// Usage: s3.presigned.put(), s3.glacier.restore(), s3.objects.remove()
```

See `lib/storage/` as the canonical example of this pattern.

## Component Naming

```typescript
// ✅ Good - PascalCase, descriptive
export function FileUploader() {}
export function StorageTierBadge() {}
export function DashboardSidebar() {}

// ❌ Bad
export function fileUploader() {} // lowercase
export function FU() {} // abbreviation
export function Uploader() {} // too generic
```

## Component Structure

Use `function` declarations for components instead of `const` arrow functions. This enables hoisting, which allows better file organization.

```typescript
// ✅ Good - function declaration
export function FileUploader() {
  return <div>...</div>;
}

// ❌ Avoid - const arrow function for components
export const FileUploader = () => {
  return <div>...</div>;
};
```

### File Organization

When components get large, split them into separate section files for readability. Use common sense - this isn't a strict rule.

When a component is large but can't or shouldn't be split, put the main export first. Helper components and utilities come after. Function hoisting makes this possible, letting readers understand the main logic before diving into details.

```typescript
// ✅ Good - main component first, helpers below
export function Dashboard() {
  const data = useDashboardData();

  return (
    <div>
      <Header />
      <StatsGrid data={data} />
      <RecentFiles />
    </div>
  );
}

// Helper components defined after - hoisting allows this
function Header() {
  return <header>...</header>;
}

function StatsGrid({ data }: StatsGridProps) {
  return <div>...</div>;
}

function RecentFiles() {
  return <section>...</section>;
}
```

## Function Naming

```typescript
// ✅ Good - camelCase, verb prefix
function uploadFile() {}
function getStorageTier() {}
function calculateUsage() {}
function handleFileSelect() {}
function formatBytes() {}

// ❌ Bad
function file_upload() {} // snake_case
function FileUpload() {} // PascalCase (for components)
function data() {} // no verb, too generic
```

## Variable Naming

```typescript
// ✅ Good
const isUploading = true;
const fileCount = 5;
const currentUser = await getUser();
const storageUsageBytes = 1024;

// ❌ Bad
const uploading = true; // missing 'is' prefix for boolean
const fc = 5; // abbreviation
const data = await get(); // too generic
```

## TypeScript

### Prefer Interfaces for Objects

```typescript
// ✅ Good
interface User {
    id: string;
    email: string;
    createdAt: Date;
}

// Use type for unions, primitives
type StorageTier = 'standard' | 'glacier' | 'deep-archive';
type FileId = string;
```

### Explicit Return Types

```typescript
// ✅ Good - explicit return for public functions
export function formatBytes(bytes: number): string {
    // ...
}

// ✅ OK - inferred for simple internal functions
const double = (n: number) => n * 2;
```

### Avoid `any`

```typescript
// ✅ Good
function processData(data: unknown): void {}
function handleError(error: Error): void {}

// ❌ Bad
function processData(data: any): void {}
```

## Import Order

```typescript
// 1. React/Next.js
import { useState } from 'react';
import { NextRequest } from 'next/server';

// 2. External libraries
import { z } from 'zod';
import { format } from 'date-fns';

// 3. Internal aliases (@/)
import { Button } from '@/components/ui/button';
import { uploadFile } from '@/actions/files';

// 4. Relative imports
import { FileIcon } from './file-icon';
import type { FileData } from './types';

// 5. Types (if separate)
import type { User } from '@/types';
```

## Props Interface

```typescript
// ✅ Good - named interface above component
interface FileCardProps {
    file: FileData;
    onDelete?: (id: string) => void;
}

export function FileCard({ file, onDelete }: FileCardProps) {
    // ...
}
```

## Comments

```typescript
// ✅ Good - explain WHY, not WHAT
// Using chunked upload to handle files > 5MB without timeout
await uploadChunked(file);

// ✅ Good - document non-obvious behavior
// Glacier retrieval can take 3-5 hours, notify user
await initiateRestore(fileId);

// ❌ Bad - obvious from code
// Set uploading to true
setIsUploading(true);
```

## Error Handling

Nexus uses a layered error handling strategy:

| Layer           | Purpose              | Tool                             |
| --------------- | -------------------- | -------------------------------- |
| tRPC errors     | API failures         | Global error link → Sonner toast |
| Route errors    | Unhandled exceptions | Next.js `error.tsx` boundaries   |
| Form validation | Field-level errors   | TanStack Form + Zod (inline)     |
| Form submission | Server rejection     | Custom `onError` → toast         |

### tRPC Error Handling

A global error link intercepts all tRPC errors and shows toasts automatically. Components can override this behavior.

**Error code mapping:**

| tRPC Code               | User Message                           |
| ----------------------- | -------------------------------------- |
| `UNAUTHORIZED`          | Please sign in to continue             |
| `FORBIDDEN`             | You do not have permission             |
| `NOT_FOUND`             | The requested resource was not found   |
| `TOO_MANY_REQUESTS`     | Too many requests. Please slow down    |
| `INTERNAL_SERVER_ERROR` | Something went wrong. Please try again |

**Per-component override:**

```typescript
// Skip global toast and handle errors yourself
const mutation = useMutation(
    trpc.files.delete.mutationOptions({
        trpc: { context: { skipToast: true } },
        onError(error) {
            if (error.data?.code === 'NOT_FOUND') {
                toast.info('File was already deleted');
            } else {
                toast.error('Failed to delete file');
            }
        },
    })
);
```

### Error Boundaries

Two levels of error boundaries catch unhandled exceptions:

- **`app/error.tsx`** - Route-level errors. Uses UI components (Card, Button). Shows retry + home link.
- **`app/global-error.tsx`** - Root layout errors. Inline styles only (no CSS/theme deps). Last resort fallback.

### Form Error Handling

Forms use TanStack Form with Zod validation:

- **Field validation** - Inline errors below each field via `field.state.meta.errors`
- **Submission errors** - Skip global toast, use custom `onError` with specific messages

```typescript
// ✅ Good - specific error types
try {
    await uploadFile(file);
} catch (error) {
    if (error instanceof StorageQuotaError) {
        toast.error('Storage quota exceeded');
    } else if (error instanceof NetworkError) {
        toast.error('Network error, please retry');
    } else {
        toast.error('Upload failed');
        console.error('Unexpected upload error:', error);
    }
}
```

## Testing

### Smoke Tests for Pages

Every new page should have a corresponding E2E smoke test in `apps/web/e2e/smoke/`. These tests verify that pages render without console errors, catching:

- Hydration mismatches from SSR/client differences
- Missing `nativeButton={false}` on Base UI components with non-button `render` props
- Broken imports or missing dependencies
- React warnings from invalid prop usage

**Pattern:**

```typescript
// e2e/smoke/feature.spec.ts
import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test('feature page renders without console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);

    await page.goto('/feature');

    // Verify key elements are present
    await expect(page.getByRole('heading', { name: 'Feature' })).toBeVisible();

    // Check for console errors after render
    expect(errors).toEqual([]);
});
```

The `setupConsoleErrorTracking` helper lives in `e2e/utils.ts` and is shared across all test files.

**Why smoke tests matter:**

When importing UI from v0 or other generators, components often have subtle issues that only surface at render time. Smoke tests catch these immediately rather than discovering them in production.

### Unit Tests

Unit test utilities and pure functions with logic. Skip unit tests for presentational components - E2E tests cover those better.

```bash
pnpm -F web test           # Unit tests (watch mode)
pnpm -F web test:run       # Unit tests (single run)
pnpm -F web test:e2e:smoke # Smoke tests only (fast)
pnpm -F web test:e2e       # All E2E tests
```

## Server Architecture

See [[../guides/server-architecture|Server Architecture Guide]] for the full layered pattern (Repository → Service → tRPC).

**Quick reference:**

| Layer          | Location                  | Responsibility                          |
| -------------- | ------------------------- | --------------------------------------- |
| **Repository** | `server/db/repositories/` | Pure data access, explicit return types |
| **Service**    | `server/services/`        | Business logic, domain errors           |
| **tRPC**       | `server/trpc/routers/`    | Input validation, thin delegation       |

## Database (Drizzle)

### Schema Changes

Edit `server/db/schema.ts`, then generate migration:

```bash
pnpm -F web db:generate
pnpm -F web db:migrate
```

### Custom Migrations (functions, triggers)

For things Drizzle can't express (Postgres functions, triggers), generate an empty migration:

```bash
pnpm -F web db:custom add-notify-trigger
# Edit server/db/migrations/XXXX_add-notify-trigger.sql
pnpm -F web db:migrate
```

### Authorization

Authorization is handled at the **application layer** (tRPC procedures), not the database layer. We do not use Supabase RLS policies since we access the database directly via Drizzle, not through Supabase's Data API.

### AI Rules

1. **Always use drizzle-kit** - Never manually create migration files
2. **Never edit `meta/` journal** - Managed by drizzle-kit
3. **Flag destructive changes** - Warn before dropping columns/tables
4. **Commit migrations** - Schema + migration files go together

## Issue-Driven Development

All non-trivial work requires a GitHub Issue:

| When        | What                                                   |
| ----------- | ------------------------------------------------------ |
| Before work | Issue defines scope, acceptance criteria, out-of-scope |
| During work | Reference issue in commits: `feat: add X (#42)`        |
| After work  | PR body includes `Closes #42`                          |

**Why issues first?**

- Prevents scope creep (out-of-scope is explicit)
- Creates audit trail of decisions
- Enables parallel work coordination

**AI tools follow the same workflow** - ask for or propose issues before non-trivial work.

## Related

- [[patterns|Code Patterns]] - Implementation examples
- [[context|Project Context]] - Background and architecture
- [[database-workflow|Database Workflow]] - Full migration guide
- [[ai/_index|Back to AI Docs]]
