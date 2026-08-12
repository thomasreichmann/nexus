---
title: Error Handling
created: 2026-03-07
updated: 2026-08-12
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

A global error link intercepts all tRPC errors and shows toasts automatically. The link is the single owner of error-toast copy — mutations configure it through `toastContext(...)` rather than reimplementing toasts in per-mutation `onError` handlers.

**Error message strategy:**

`getErrorMessage` in `apps/web/lib/trpc/error-link.ts` resolves the toast copy in this order:

1. **Mapped domain copy** — `domainErrorMessages` maps a `domainCode` to fixed user-facing copy for codes whose server message is written for logs (currently `NOT_FOUND` → "That item is no longer available"; `NotFoundError` says "File not found: \<uuid\>"). A mapped code beats everything, including a per-mutation `errorMessage` — don't add a code whose server messages should reach users.
2. **`INTERNAL_SERVER_ERROR` and transport failures** — the server message may leak implementation details, so it is never shown: the per-mutation `errorMessage` if one was passed, else the generic "Something went wrong. Please try again".
3. **Server message** — everything else shows `err.message`; the remaining `DomainError` subclasses (`InvalidStateError`, `ForbiddenError`, `TrialExpiredError`, …) already write user-facing messages.
4. **Code fallbacks** — when the server message is empty, per-code copy, then `errorMessage`, then the generic.

| tRPC Code               | Message Source                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| `UNAUTHORIZED`          | Fallback: "Please sign in to continue" (when server message is empty) |
| `FORBIDDEN`             | Server message (from `ForbiddenError`)                                |
| `NOT_FOUND`             | Mapped copy: "That item is no longer available"                       |
| `TOO_MANY_REQUESTS`     | Fallback: "Too many requests. Please slow down"                       |
| `INTERNAL_SERVER_ERROR` | Per-mutation `errorMessage`, else the generic fallback                |

**Per-mutation configuration:**

Always build the operation context with `toastContext(...)` — the raw context type is `Record<string, unknown>`, so a typo'd key in a hand-written literal compiles fine and silently re-enables the toast it meant to configure.

```typescript
import { toastContext } from '@/lib/trpc/error-link';

// Give 500s/transport failures a task-specific message.
// Domain and code-specific copy still win over it.
const mutation = useMutation(
    trpc.files.requestRetrieval.mutationOptions({
        trpc: toastContext({ errorMessage: 'Failed to request retrieval' }),
    })
);

// Escape hatch: suppress the toast entirely, for components that render
// the error some other way (e.g. a banner) — not for substituting their
// own toast.
const mutation = useMutation(
    trpc.files.delete.mutationOptions({
        trpc: toastContext({ skipToast: true }),
        onError(error) {
            /* render the error in-component */
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
        trpc: toastContext({ skipToast: true }),
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

`getDomainError` makes no assumptions about toast behavior — pair it with `toastContext({ skipToast: true })` when you want custom per-component handling, or leave the global toast in place and let it drive an auxiliary UI (e.g. a banner) alongside it.

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
