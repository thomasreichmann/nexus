---
title: Error Handling
created: 2026-03-07
updated: 2026-03-07
status: active
tags:
    - conventions
    - error-handling
aliases:
    - Error Handling Guide
---

# Error Handling

Nexus uses a layered error handling strategy.

## Layers

| Layer           | Purpose              | Tool                             |
| --------------- | -------------------- | -------------------------------- |
| tRPC errors     | API failures         | Global error link → Sonner toast |
| Route errors    | Unhandled exceptions | Next.js `error.tsx` boundaries   |
| Form validation | Field-level errors   | TanStack Form + Zod (inline)     |
| Form submission | Server rejection     | Custom `onError` → toast         |

## tRPC Error Handling

A global error link intercepts all tRPC errors and shows toasts automatically. Components can override this behavior.

**Error message strategy:**

The error link uses the server's `err.message` by default — domain errors (`NotFoundError`, `ForbiddenError`, etc.) already set user-facing messages. Only `INTERNAL_SERVER_ERROR` is replaced with a generic fallback to avoid leaking implementation details.

| tRPC Code               | Message Source                                            |
| ----------------------- | --------------------------------------------------------- |
| `UNAUTHORIZED`          | Fallback: "Please sign in to continue"                    |
| `FORBIDDEN`             | Server message (from `ForbiddenError`)                    |
| `NOT_FOUND`             | Server message (from `NotFoundError`)                     |
| `TOO_MANY_REQUESTS`     | Fallback: "Too many requests. Please slow down"           |
| `INTERNAL_SERVER_ERROR` | Always fallback: "Something went wrong. Please try again" |

**Per-component override:**

```typescript
// Skip global toast and handle errors yourself
const mutation = useMutation(
    trpc.files.delete.mutationOptions({
        trpc: { context: { skipToast: true } },
        onError(error) {
            const domain = getDomainError(error);
            if (domain?.code === 'NOT_FOUND') {
                toast.info('File was already deleted');
            } else {
                toast.error('Failed to delete file');
            }
        },
    })
);
```

## Discriminating Domain Errors (`domainCode`)

`DomainError` subclasses carry a machine-readable `code` that is serialized onto `err.data.domainCode`. The frontend uses this to distinguish errors that share a tRPC code (e.g. a generic `FORBIDDEN` vs. a `TRIAL_EXPIRED`), so components can branch exhaustively without fragile message-string matching.

**Recommended: `getDomainError`**

```typescript
import { getDomainError } from '@/lib/trpc/get-domain-error';

const mutation = useMutation(
    trpc.files.delete.mutationOptions({
        trpc: { context: { skipToast: true } },
        onError(error) {
            const domain = getDomainError(error);
            switch (domain?.code) {
                case 'NOT_FOUND':
                    toast.info('File was already deleted');
                    return;
                case 'TRIAL_EXPIRED':
                    // handled elsewhere (e.g. <TrialExpiredBanner />)
                    return;
                default:
                    toast.error('Failed to delete file');
            }
        },
    })
);
```

Adding a new entry to `DOMAIN_ERROR_CODES` (in `apps/web/server/errors.ts`) without updating a `switch` over `DomainErrorCode` surfaces as a TypeScript error.

**Fallback: bare `error.data?.code`**

Some server throws are bare `TRPCError` instances (e.g. admin gates) without a `domainCode`. In that case `getDomainError` returns `null` and callers can fall back to `error.data?.code` (the tRPC code) for coarse branching:

```typescript
if (error.data?.code === 'UNAUTHORIZED') {
    // redirect to sign in
}
```

**Composes with `skipToast`**

`getDomainError` makes no assumptions about toast behavior — pair it with `context: { skipToast: true }` when you want custom per-component handling, or leave the global toast in place and let it drive an auxiliary UI (e.g. a banner) alongside it.

## Error Boundaries

Two levels of error boundaries catch unhandled exceptions:

- **`app/error.tsx`** - Route-level errors. Uses UI components (Card, Button). Shows retry + home link.
- **`app/global-error.tsx`** - Root layout errors. Inline styles only (no CSS/theme deps). Last resort fallback.

## Form Error Handling

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

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
