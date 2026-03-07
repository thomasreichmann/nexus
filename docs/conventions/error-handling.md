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
            if (error.data?.code === 'NOT_FOUND') {
                toast.info('File was already deleted');
            } else {
                toast.error('Failed to delete file');
            }
        },
    })
);
```

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
