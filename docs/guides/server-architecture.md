---
title: Server Architecture
created: 2026-01-19
updated: 2026-02-27
status: active
tags:
    - guide
    - backend
    - architecture
aliases:
    - Repository Pattern
    - Service Layer
---

# Server Architecture

Database-to-server communication patterns for the Nexus backend.

## Layered Pattern (Service + Repository)

```
tRPC Procedure (input validation, auth, response shaping)
    ↓
Service (business logic, orchestration, side effects)
    ↓
Repository (data access, queries, mutations)
    ↓
Drizzle / Database
```

**Adoption is optional** — extract layers as complexity grows:

- Simple CRUD → inline in tRPC
- Reused queries → repository
- Business logic → service

## Folder Structure

```
packages/db/src/               # @nexus/db package
├── connection.ts              # createDb, DB, Connection, Transaction types
├── schema/                    # Table definitions, enums, constants
├── repositories/              # Data access layer (factory pattern)
│   ├── create.ts             # createRepository() auto-bind helper
│   ├── files.ts              # createFileRepo factory
│   ├── jobs.ts               # createJobRepo factory
│   ├── retrievals.ts         # createRetrievalRepo factory
│   └── webhooks.ts           # createWebhookRepo factory
└── testing.ts                 # Mock DB, fixtures, test constants

apps/web/server/
├── db/
│   └── index.ts              # Drizzle instance (re-exports from @nexus/db)
├── errors.ts                  # Domain errors
├── services/                  # Business logic layer (no index.ts!)
│   ├── files.ts              # Exports: fileService
│   └── storage.ts            # Exports: storageService
└── trpc/
    ├── init.ts               # tRPC setup + error middleware
    ├── router.ts             # Router composition
    └── routers/              # Thin procedures
        ├── files.ts
        └── ...
```

> **No barrel exports in services/** — Each service file exports its own namespace object. Import directly from the service file: `import { fileService } from '@/server/services/files'`. This prevents accidentally bundling all services when you only need one.

## Layer Responsibilities

| Layer          | Location                        | Responsibility                                      |
| -------------- | ------------------------------- | --------------------------------------------------- |
| **Repository** | `packages/db/src/repositories/` | Pure data access, no business logic, no errors      |
| **Service**    | `server/services/`              | Business rules, orchestration, throws domain errors |
| **tRPC**       | `server/trpc/routers/`          | Input validation, auth, delegates to service/repo   |

---

## Shared DB Type

Types are defined in `@nexus/db` and re-exported from `apps/web/server/db/`:

```typescript
// apps/web/server/db/index.ts
import { createDb } from '@nexus/db';
import { env } from '@/lib/env';

export const db = createDb(env.DATABASE_URL);
export type { DB, Transaction } from '@nexus/db';
```

`DB` is a union type (`Connection | Transaction`) so repository factories work seamlessly inside transactions. See [[db-subpaths|@nexus/db Subpath Exports]] for details.

---

## Repository Layer

Repositories are **pure data access** — no business logic, no side effects, no error throwing.

### Conventions

| Convention       | Rule                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| **API surface**  | Factory only: `create<Entity>Repo(db)` — standalone functions are private     |
| **Return types** | Always explicit — prevents Drizzle inference propagation                      |
| **Naming**       | Short: `findById`, `insert`, `update` — entity context comes from the factory |
| **Queries**      | Use `db.query.*` (relational API) for reads                                   |
| **Aggregates**   | Use `db.select()` builder for complex SQL                                     |
| **Mutations**    | Always use `.returning()` with destructuring                                  |

### Example

```typescript
// packages/db/src/repositories/files.ts
import { eq, and, desc, sql } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

// Functions are module-private — not exported directly

function findById(db: DB, id: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.id, id),
    });
}

function findByUser(
    db: DB,
    userId: string,
    opts: { limit: number; offset: number } = { limit: 50, offset: 0 }
): Promise<File[]> {
    return db.query.files.findMany({
        where: eq(schema.files.userId, userId),
        orderBy: desc(schema.files.createdAt),
        limit: opts.limit,
        offset: opts.offset,
    });
}

async function sumStorageByUser(db: DB, userId: string): Promise<number> {
    const [result] = await db
        .select({
            total: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`,
        })
        .from(schema.files)
        .where(eq(schema.files.userId, userId));

    return Number(result?.total ?? 0);
}

async function insert(db: DB, data: NewFile): Promise<File> {
    const [file] = await db.insert(schema.files).values(data).returning();
    return file;
}

// createRepository() auto-binds `db` to each function
export const createFileRepo = createRepository({
    findById,
    findByUser,
    sumStorageByUser,
    insert,
    // ...
});

export type FileRepo = ReturnType<typeof createFileRepo>;
```

Consumers import the factory from the subpath:

```typescript
import { createFileRepo } from '@nexus/db/repo/files';

const fileRepo = createFileRepo(db);
const file = await fileRepo.findById(id);
```

---

## Domain Errors

Services throw domain-specific errors. Each error passes its tRPC code to the base class, and middleware handles the mapping.

### Error Definitions

```typescript
// server/errors.ts
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/** Base class for all domain errors. */
export abstract class DomainError extends Error {
    constructor(
        message: string,
        public readonly trpcCode: TRPC_ERROR_CODE_KEY
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

/** Resource not found. */
export class NotFoundError extends DomainError {
    constructor(entity: string, id?: string) {
        super(
            id ? `${entity} not found: ${id}` : `${entity} not found`,
            'NOT_FOUND'
        );
    }
}

/** User doesn't have permission. */
export class ForbiddenError extends DomainError {
    constructor(message = 'You do not have permission to perform this action') {
        super(message, 'FORBIDDEN');
    }
}

/** Operation not allowed in current state. */
export class InvalidStateError extends DomainError {
    constructor(message: string) {
        super(message, 'BAD_REQUEST');
    }
}

/** Quota or limit exceeded. */
export class QuotaExceededError extends DomainError {
    constructor(message = 'Quota exceeded') {
        super(message, 'PRECONDITION_FAILED');
    }
}
```

### Error Handler Middleware

Add to `server/trpc/init.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { DomainError } from '@/server/errors';

const errorHandlerMiddleware = t.middleware(async ({ next }) => {
    try {
        return await next();
    } catch (error) {
        if (error instanceof DomainError) {
            throw new TRPCError({
                code: error.trpcCode,
                message: error.message,
                cause: error,
            });
        }
        throw error;
    }
});

// Apply to all procedures
export const publicProcedure = t.procedure.use(errorHandlerMiddleware);
export const protectedProcedure = t.procedure
    .use(authMiddleware)
    .use(errorHandlerMiddleware);
```

---

## Service Layer

Services contain business logic and throw domain errors. Each service file exports a **namespace object** (not individual functions) to provide a clean API and prevent barrel export issues.

### Conventions

| Convention          | Rule                                                            |
| ------------------- | --------------------------------------------------------------- |
| **Export pattern**  | Namespace object: `export const fileService = { ... } as const` |
| **First parameter** | Always `db: DB` — same as repositories                          |
| **Return types**    | Inferred — repos have explicit types, chain is broken there     |
| **Errors**          | Throw domain errors (`NotFoundError`, etc), never `TRPCError`   |
| **Side effects**    | Coordinate with `lib/` modules (S3, email, etc)                 |
| **Naming**          | `<action><Noun>` — describes the business operation             |

### Example

```typescript
// server/services/files.ts
import type { DB } from '@nexus/db';
import { createFileRepo, type File } from '@nexus/db/repo/files';
import { NotFoundError, QuotaExceededError } from '@/server/errors';
import { s3 } from '@/lib/storage';

const MAX_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB

// Functions are private (not exported individually)
async function initiateUpload(
    db: DB,
    userId: string,
    input: { name: string; sizeBytes: number; mimeType?: string }
) {
    const fileRepo = createFileRepo(db);
    const currentUsage = await fileRepo.sumStorageByUser(userId);
    if (currentUsage + input.sizeBytes > MAX_STORAGE_BYTES) {
        throw new QuotaExceededError('Storage quota exceeded');
    }

    const fileId = crypto.randomUUID();
    const s3Key = `${userId}/${fileId}/${input.name}`;
    const uploadUrl = await s3.presigned.put(s3Key);

    await fileRepo.insert({
        id: fileId,
        userId,
        name: input.name,
        size: input.sizeBytes,
        mimeType: input.mimeType ?? null,
        s3Key,
        status: 'uploading',
    });

    return { fileId, uploadUrl };
}

async function confirmUpload(db: DB, userId: string, fileId: string) {
    const fileRepo = createFileRepo(db);
    const file = await fileRepo.findByUserAndId(userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    const updated = await fileRepo.update(fileId, {
        status: 'available',
    });

    return { file: updated };
}

// Export as namespace object — this is the public API
export const fileService = {
    initiateUpload,
    confirmUpload,
} as const;
```

### Anti-patterns

```typescript
// ❌ BAD: Individual exports allow wrong import patterns
export async function initiateUpload(...) { }
export async function confirmUpload(...) { }

// ❌ BAD: Barrel file aggregates all services
// server/services/index.ts
export * as fileService from './files';
export * as userService from './users';  // Now importing fileService also loads userService!

// ✅ GOOD: Namespace object in each service file
export const fileService = { initiateUpload, confirmUpload } as const;
// Import: import { fileService } from '@/server/services/files';
```

---

## tRPC Router Layer

tRPC procedures are thin — they validate input, delegate to services/repos, and return results. Domain errors are automatically mapped by middleware.

### Conventions

| Convention       | Rule                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Procedures**   | Thin — input validation, delegate to service/repo, return    |
| **Errors**       | Don't catch — let middleware map domain errors automatically |
| **Complex ops**  | Delegate to services                                         |
| **Simple reads** | Can call repos directly                                      |
| **Inline code**  | Only for trivial transformations (e.g., formatting response) |

### Example

```typescript
// server/trpc/routers/files.ts
import { z } from 'zod';
import { protectedProcedure, router } from '../init';
import { createFileRepo } from '@nexus/db/repo/files';
import { fileService } from '@/server/services/files';

export const filesRouter = router({
    // Complex operations delegate to services
    upload: protectedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(255),
                sizeBytes: z.number().positive(),
                mimeType: z.string().optional(),
            })
        )
        .mutation(({ ctx, input }) => {
            return fileService.initiateUpload(
                ctx.db,
                ctx.session.user.id,
                input
            );
        }),

    confirmUpload: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.confirmUpload(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),

    // Simple queries can use repository factory directly
    list: protectedProcedure
        .input(
            z
                .object({
                    limit: z.number().min(1).max(100).default(50),
                    offset: z.number().min(0).default(0),
                })
                .optional()
        )
        .query(({ ctx, input }) => {
            const fileRepo = createFileRepo(ctx.db);
            return fileRepo.findByUser(ctx.session.user.id, input);
        }),
});
```

---

## When to Extract

| Complexity                                | Approach                              |
| ----------------------------------------- | ------------------------------------- |
| Simple CRUD, single query                 | Inline in tRPC procedure              |
| Query reused 2+ times                     | Extract to repository                 |
| Business rules, validation, orchestration | Extract to service                    |
| Side effects (S3, email, webhooks)        | Service coordinates with lib/ modules |

---

## TypeScript Performance

Drizzle + tRPC + Zod can cause slow TypeScript builds and IDE performance due to compounding type inference. We mitigate this by **breaking the inference chain at the repository layer** with explicit return types.

### Why Explicit Return Types on Repositories

Drizzle re-derives types on every query (unlike Prisma's code generation), which can cause:

- 5,000-40,000 type instantiations per query
- 10-20+ second IntelliSense delays with large schemas
- Slow `tsc` builds as complexity grows

By adding explicit return types to repository functions, TypeScript doesn't need to infer through Drizzle's complex generics:

```
❌ Without explicit types:
tRPC → Service → Repository → Drizzle → Schema (full inference chain)

✅ With explicit types on repositories:
tRPC → Service → Repository [explicit type] ← Drizzle inference stops here
```

### Escape Hatches

If IntelliSense remains slow on specific procedures:

1. Add explicit `.output()` schemas:

    ```typescript
    .output(z.object({ id: z.string(), name: z.string() }))
    ```

2. Add to `.vscode/settings.json`:
    ```json
    {
        "typescript.preferences.autoImportFileExcludePatterns": [
            "**/node_modules/drizzle-orm"
        ]
    }
    ```

---

## Related

- [[db-subpaths|@nexus/db Subpath Exports]] — Subpath reference, factory pattern, DB types
- [[database-workflow|Database Workflow]] — Schema changes and migrations
- [[../ai/conventions|Code Conventions]] — Naming and style rules
- [[../architecture/system-design|System Design]] — High-level architecture
