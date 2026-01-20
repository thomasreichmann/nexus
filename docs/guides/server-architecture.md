---
title: Server Architecture
created: 2026-01-19
updated: 2026-01-19
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
apps/web/server/
├── db/
│   ├── index.ts              # Drizzle instance + shared DB type
│   ├── schema.ts             # Table definitions
│   └── repositories/         # Data access layer
│       ├── files.ts
│       ├── users.ts
│       └── index.ts          # Re-exports
├── errors.ts                  # Domain errors
├── services/                  # Business logic layer
│   ├── files.ts
│   ├── storage.ts
│   └── index.ts              # Re-exports
└── trpc/
    ├── init.ts               # tRPC setup + error middleware
    ├── router.ts             # Router composition
    └── routers/              # Thin procedures
        ├── files.ts
        └── ...
```

## Layer Responsibilities

| Layer          | Location                  | Responsibility                                      |
| -------------- | ------------------------- | --------------------------------------------------- |
| **Repository** | `server/db/repositories/` | Pure data access, no business logic, no errors      |
| **Service**    | `server/services/`        | Business rules, orchestration, throws domain errors |
| **tRPC**       | `server/trpc/routers/`    | Input validation, auth, delegates to service/repo   |

---

## Shared DB Type

Export the DB type from `server/db/index.ts` for use in all repositories and services:

```typescript
// server/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const client = postgres(env.DATABASE_URL);
export const db = drizzle(client, { schema });

// Shared type for all repositories and services
export type DB = typeof db;
```

---

## Repository Layer

Repositories are **pure data access** — no business logic, no side effects, no error throwing.

### Conventions

| Convention          | Rule                                                         |
| ------------------- | ------------------------------------------------------------ |
| **First parameter** | Always `db: DB` — enables testing without DI                 |
| **Return types**    | Always explicit — prevents Drizzle inference propagation     |
| **Naming**          | `<verb><Entity>` for single, `<verb><Entities>ByX` for lists |
| **Queries**         | Use `db.query.*` (relational API) for reads                  |
| **Aggregates**      | Use `db.select()` builder for complex SQL                    |
| **Mutations**       | Always use `.returning()` with destructuring                 |

### Example

```typescript
// server/db/repositories/files.ts
import { eq, and, desc, sql } from 'drizzle-orm';
import type { DB } from '../index';
import * as schema from '../schema';

// Explicit return types using Drizzle's inferred types
type File = typeof schema.file.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Queries - use Drizzle's relational query API (db.query.*)
// ─────────────────────────────────────────────────────────────

/** Find a single file by ID. Returns undefined if not found. */
export function findFileById(db: DB, id: string): Promise<File | undefined> {
    return db.query.file.findFirst({
        where: eq(schema.file.id, id),
    });
}

/** Find a file owned by a specific user. */
export function findUserFile(
    db: DB,
    userId: string,
    fileId: string
): Promise<File | undefined> {
    return db.query.file.findFirst({
        where: and(eq(schema.file.id, fileId), eq(schema.file.userId, userId)),
    });
}

/** List files for a user with pagination. */
export function findFilesByUser(
    db: DB,
    userId: string,
    opts: { limit: number; offset: number } = { limit: 50, offset: 0 }
): Promise<File[]> {
    return db.query.file.findMany({
        where: eq(schema.file.userId, userId),
        orderBy: desc(schema.file.createdAt),
        limit: opts.limit,
        offset: opts.offset,
    });
}

// ─────────────────────────────────────────────────────────────
// Aggregates - use query builders when relational API isn't enough
// ─────────────────────────────────────────────────────────────

/** Calculate total storage used by a user in bytes. */
export async function sumStorageBytesByUser(
    db: DB,
    userId: string
): Promise<number> {
    const [result] = await db
        .select({
            total: sql<number>`coalesce(sum(${schema.file.sizeBytes}), 0)::bigint`,
        })
        .from(schema.file)
        .where(eq(schema.file.userId, userId));

    return Number(result?.total ?? 0);
}

// ─────────────────────────────────────────────────────────────
// Mutations - always use .returning() with destructuring
// ─────────────────────────────────────────────────────────────

/** Insert a new file record. */
export async function insertFile(db: DB, data: schema.NewFile): Promise<File> {
    const [file] = await db.insert(schema.file).values(data).returning();
    return file;
}

/** Update a file by ID. Returns undefined if file doesn't exist. */
export async function updateFile(
    db: DB,
    id: string,
    data: Partial<Omit<schema.NewFile, 'id'>>
): Promise<File | undefined> {
    const [file] = await db
        .update(schema.file)
        .set(data)
        .where(eq(schema.file.id, id))
        .returning();

    return file;
}

/** Delete a file by ID. Returns the deleted row, or undefined if not found. */
export async function deleteFile(
    db: DB,
    id: string
): Promise<File | undefined> {
    const [file] = await db
        .delete(schema.file)
        .where(eq(schema.file.id, id))
        .returning();

    return file;
}
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

Services contain business logic and throw domain errors. Return types are inferred (repos have explicit types, breaking the inference chain).

### Conventions

| Convention          | Rule                                                          |
| ------------------- | ------------------------------------------------------------- |
| **First parameter** | Always `db: DB` — same as repositories                        |
| **Return types**    | Inferred — repos have explicit types, chain is broken there   |
| **Errors**          | Throw domain errors (`NotFoundError`, etc), never `TRPCError` |
| **Side effects**    | Coordinate with `lib/` modules (S3, email, etc)               |
| **Naming**          | `<action><Noun>` — describes the business operation           |

### Example

```typescript
// server/services/files.ts
import type { DB } from '@/server/db';
import * as fileRepo from '@/server/db/repositories/files';
import {
    NotFoundError,
    QuotaExceededError,
    InvalidStateError,
} from '@/server/errors';
import { initiateGlacierRestore, generatePresignedUrl } from '@/lib/storage';

const MAX_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB

export async function uploadFile(
    db: DB,
    userId: string,
    input: { name: string; sizeBytes: number; mimeType?: string }
) {
    // Business rule: check storage quota
    const currentUsage = await fileRepo.sumStorageBytesByUser(db, userId);
    if (currentUsage + input.sizeBytes > MAX_STORAGE_BYTES) {
        throw new QuotaExceededError('Storage quota exceeded');
    }

    // Generate S3 key and presigned URL
    const s3Key = `${userId}/${crypto.randomUUID()}/${input.name}`;
    const uploadUrl = await generatePresignedUrl(s3Key, 'PUT');

    // Create file record
    const file = await fileRepo.insertFile(db, {
        userId,
        name: input.name,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        s3Key,
        storageTier: 'standard',
    });

    return { file, uploadUrl };
}

export async function requestRetrieval(db: DB, userId: string, fileId: string) {
    const file = await fileRepo.findUserFile(db, userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    if (file.retrievalStatus === 'pending') {
        throw new InvalidStateError('Retrieval already in progress');
    }

    // Orchestrate: S3 restore + DB update
    await initiateGlacierRestore(file.s3Key);
    const updated = await fileRepo.updateFile(db, fileId, {
        retrievalStatus: 'pending',
    });

    return updated;
}

export async function deleteUserFile(db: DB, userId: string, fileId: string) {
    const file = await fileRepo.findUserFile(db, userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    await fileRepo.deleteFile(db, fileId);
    // Queue S3 deletion separately (not blocking)

    return file;
}
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
import * as fileService from '@/server/services/files';
import * as fileRepo from '@/server/db/repositories/files';

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
            return fileService.uploadFile(ctx.db, ctx.session.user.id, input);
        }),

    requestRetrieval: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.requestRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.id
            );
        }),

    delete: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.deleteUserFile(
                ctx.db,
                ctx.session.user.id,
                input.id
            );
        }),

    // Simple queries can use repository directly
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
            return fileRepo.findFilesByUser(ctx.db, ctx.session.user.id, input);
        }),

    // Very simple operations can stay inline
    stats: protectedProcedure.query(async ({ ctx }) => {
        const totalBytes = await fileRepo.sumStorageBytesByUser(
            ctx.db,
            ctx.session.user.id
        );
        return {
            storageBytes: totalBytes,
            storageGb: Number(totalBytes) / 1024 ** 3,
        };
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

- [[database-workflow|Database Workflow]] — Schema changes and migrations
- [[../ai/conventions|Code Conventions]] — Naming and style rules
- [[../architecture/system-design|System Design]] — High-level architecture
