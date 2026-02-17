---
title: '@nexus/db Subpath Exports'
created: 2026-02-17
updated: 2026-02-17
status: active
tags:
    - guide
    - database
    - architecture
aliases:
    - DB Subpaths
    - Repository Factory Pattern
---

# @nexus/db Subpath Exports

The `@nexus/db` package uses subpath exports to provide clean module boundaries. Each subpath exposes a focused API instead of a single barrel export.

## Subpath Reference

| Subpath                     | Contents                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `@nexus/db`                 | `createDb`, `DB`, `Transaction`                              |
| `@nexus/db/schema`          | All schema tables, enums, constants, `timestamps` helper     |
| `@nexus/db/repo/files`      | `createFileRepo` factory + standalone functions + types      |
| `@nexus/db/repo/jobs`       | `createJobRepo` factory + standalone functions + job types   |
| `@nexus/db/repo/retrievals` | `createRetrievalRepo` factory + standalone functions + types |
| `@nexus/db/repo/webhooks`   | `createWebhookRepo` factory + standalone functions + types   |
| `@nexus/db/testing`         | `createMockDb`, fixture factories, test constants            |

## DB Type

`DB` is a union type that accepts both database connections and transactions:

```typescript
type DB = Connection | Transaction;
```

This means repository functions don't need to know whether they're running inside a transaction — `DB` covers both. To run queries in a transaction, create a repo from the transaction parameter:

```typescript
await db.transaction(async (tx) => {
    const fileRepo = createFileRepo(tx);
    await fileRepo.softDeleteForUser(userId, fileIds);
});
```

The architectural constraint is correct by design: `db.transaction()` cannot be called on a `Transaction` (TypeScript rejects it), which prevents nested transactions. Repos should never start transactions — callers should.

## Repository Factory Pattern

Each repository exports a `create<Entity>Repo(db)` factory that binds a `DB` instance and returns a typed namespace object with short method names:

```typescript
import { createFileRepo } from '@nexus/db/repo/files';

const fileRepo = createFileRepo(db);
const file = await fileRepo.findById(id);
const files = await fileRepo.findByUser(userId, { limit: 50, offset: 0 });
```

### When to Use Factories vs Standalone Functions

Both patterns are available. Choose based on context:

- **Factories** — when you call multiple repo methods in the same scope (tRPC routers, services with many queries)
- **Standalone functions** — when you call one or two functions (simple helpers, one-off queries)

```typescript
// Factory — binds db once, reuse across calls
const fileRepo = createFileRepo(ctx.db);
const files = await fileRepo.findByUser(userId);
const count = await fileRepo.countByUser(userId);

// Standalone — explicit db parameter each time
import { findByS3Key } from '@nexus/db/repo/files';
const file = await findByS3Key(db, s3Key);
```

### Factory Type Export

Each factory exports a `<Entity>Repo` type for use in function signatures:

```typescript
import type { FileRepo } from '@nexus/db/repo/files';

function processFiles(fileRepo: FileRepo) {
    // ...
}
```

## Adding a New Repository

1. Create `packages/db/src/repositories/<entity>.ts` with:
    - Entity types (`type Entity = ...`, `type NewEntity = ...`)
    - Standalone functions with `db: DB` as first parameter
    - `create<Entity>Repo(db: DB)` factory with short method names
    - `type <Entity>Repo = ReturnType<typeof create<Entity>Repo>`

2. Add the subpath to `packages/db/package.json`:

    ```json
    "./repo/<entity>": {
        "import": "./src/repositories/<entity>.ts",
        "types": "./src/repositories/<entity>.ts"
    }
    ```

3. If the repo needs test fixtures, add them to `packages/db/src/repositories/fixtures.ts`

## Related

- [[../ai/conventions|Code Conventions]] — naming and style rules
- [[server-architecture|Server Architecture]] — Repository → Service → tRPC layers
