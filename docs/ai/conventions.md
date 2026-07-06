---
title: Code Conventions
created: 2025-12-29
updated: 2026-03-07
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

Terse reference for AI agents. Detailed examples with code: [[../conventions/naming|Naming]], [[../conventions/typescript|TypeScript]], [[../conventions/components|Components]], [[../conventions/error-handling|Error Handling]], [[../conventions/testing|Testing]].

## File Naming

| Type       | Convention                | Example               |
| ---------- | ------------------------- | --------------------- |
| Components | `PascalCase.tsx`          | `FileUploader.tsx`    |
| Utilities  | `camelCase.ts`            | `formatBytes.ts`      |
| Hooks      | `useCamelCase.ts`         | `useFileUpload.ts`    |
| Tests      | `*.test.ts` / `*.spec.ts` | `formatBytes.test.ts` |

## Library (`apps/web/lib/`) Organization

- **Domain folders**: `lib/auth/*`, `lib/env/*`, `lib/trpc/*`, `lib/storage/*`
- **Concept modules**: one cohesive concept per file (not one function per file)
- **Client/server**: `lib/auth/client.ts` vs `lib/auth/server.ts` when needed
- **Promotion rule**: keep helpers local until reused, then promote to `lib/<domain>/`
- **Namespace exports**: multi-operation modules use structured namespace objects (see `lib/storage/` as canonical example)

## Naming Rules

- **Components**: PascalCase, descriptive (`FileUploader` not `FU`)
- **Functions**: camelCase, verb prefix (`uploadFile`, `getStorageTier`)
- **Variables**: `is` prefix for booleans, no abbreviations, no generic names
- **Props**: named interface above component (`interface FileCardProps`)
- **Comments**: explain WHY, not WHAT

## Component Structure

- Use `function` declarations (not `const` arrows) for components — enables hoisting
- Main export first, helper components below
- Split large components into section files when needed

## TypeScript

- Interfaces for objects, types for unions/primitives
- Explicit return types on public/exported functions
- Never use `any` — use `unknown` instead
- Import order: React → External → Internal (`@/`) → Relative → Types

## Error Handling

| Layer           | Tool                             |
| --------------- | -------------------------------- |
| tRPC errors     | Global error link → Sonner toast |
| Route errors    | `error.tsx` / `global-error.tsx` |
| Form validation | TanStack Form + Zod (inline)     |
| Form submission | Custom `onError` → toast         |

- Domain errors set user-facing messages; `INTERNAL_SERVER_ERROR` always uses generic fallback
- Override per-component with `trpc: { context: { skipToast: true } }`
- Full details: [[../conventions/error-handling|Error Handling]]

## Testing

- Public pages: smoke test in `e2e/smoke/` using `setupConsoleErrorTracking`
- Authenticated pages: smoke test in `e2e/smoke/authenticated/` using `authenticated` fixture (supports `userRole`)
- Auth E2E tests use `storageState` pattern via Playwright `setup` project
- Unit test utilities/pure functions only; skip presentational components
- Test commands: `pnpm -F web test`, `test:e2e:smoke`, `test:e2e:admin`, `test:e2e`
- Full details: [[../conventions/testing|Testing]]

## Server Architecture

| Layer          | Location                        | Responsibility                       |
| -------------- | ------------------------------- | ------------------------------------ |
| **Repository** | `packages/db/src/repositories/` | Pure data access via factory pattern |
| **Service**    | `server/services/`              | Business logic, domain errors        |
| **tRPC**       | `server/trpc/routers/`          | Input validation, thin delegation    |

See [[../guides/server-architecture|Server Architecture Guide]] for the full layered pattern.

## Namespace Patterns

- **Repository factories**: `@nexus/db` repositories export `create<Entity>Repo(db)` factories that return typed namespace objects with short method names.
- **Stateless utilities**: barrel files build namespace objects from explicit named imports, not `import * as`. Example: `import { put as presignedPut } from './presigned'`, then `const presigned = { put: presignedPut } as const`.
- **Public API stability**: keep nested namespaces stable (`s3.presigned.put()`, `s3.glacier.restore()`, `s3.objects.remove()`) even when internal imports change.

## Auth Enforcement

- `apps/web/proxy.ts` guards `/dashboard/*` with an **optimistic** cookie-presence check (no DB hit) — a UX layer only. It redirects signed-out users to `/sign-in?redirect=<path>` and signed-in users away from the auth pages.
- The proxy is **not** real protection: a forged cookie gets past it, sees an empty shell, and 401s. Real enforcement is tRPC's `protectedProcedure`.
- Any dashboard page that fetches data in a **server component** must do its own `auth.api.getSession` check (precedent: `app/(dashboard)/dashboard/admin/layout.tsx`) — the proxy does not cover it.

## Issue-Driven Development

All non-trivial work requires a GitHub Issue with scope, acceptance criteria, and out-of-scope.

## Related

- [[patterns|Code Patterns]] - Implementation examples
- [[context|Project Context]] - Background and architecture
- [[_index|Back to AI Docs]]
