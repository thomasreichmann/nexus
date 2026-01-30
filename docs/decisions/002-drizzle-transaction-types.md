---
title: 'ADR-002: Drizzle Transaction Type Pattern'
created: 2026-01-29
updated: 2026-01-29
status: accepted
tags:
    - decisions
    - adr
    - drizzle
    - database
    - typescript
aliases:
    - Transaction Types
---

# ADR-002: Drizzle Transaction Type Pattern

## Status

**Accepted**

## Context

Repository functions need to work both standalone and within database transactions. For example, `softDeleteUserFiles` may be called directly or within a `db.transaction()` callback for atomic operations with rollback support.

Drizzle ORM's transaction callback receives a `tx` parameter that has a different type than the main `db` instance - it lacks the `$client` property but shares the query/mutation interface. TypeScript rejects passing `tx` to functions typed as `(db: DB) => ...`.

Drizzle does not currently provide built-in type utilities for this use case, and the documentation has a known gap here.

## Decision Drivers

- **Type safety** - Functions should accept both `db` and `tx` with proper typing
- **Simplicity** - Avoid verbose type imports that may break with Drizzle updates
- **Maintainability** - Types should stay in sync with the db instance automatically

## Considered Options

### Option 1: Explicit Type Imports

Import and compose types explicitly from Drizzle:

```typescript
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';

export type Transaction = PgTransaction<
    PostgresJsQueryResultHKT,
    typeof schema,
    ExtractTablesWithRelations<typeof schema>
>;
```

**Pros:**

- Explicit and self-documenting
- Clear what types are involved

**Cons:**

- Verbose (4 imports, complex generic composition)
- May break if Drizzle changes internal type names
- Must manually keep in sync with db configuration

### Option 2: Parameters Extraction (Chosen)

Derive the transaction type from the db instance:

```typescript
export type DB = typeof db;
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DBOrTransaction = DB | Transaction;
```

**Pros:**

- Minimal imports (none from drizzle-orm for types)
- Automatically stays in sync with db instance
- Resilient to Drizzle API changes
- Community-recommended pattern

**Cons:**

- Less immediately obvious what the type represents
- Nested `Parameters<>` extraction is a TypeScript idiom some may find unfamiliar

## Decision

Use **Parameters extraction** to derive the Transaction type from the db instance.

Implementation in `server/db/index.ts`:

```typescript
export type DB = typeof db;
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DBOrTransaction = DB | Transaction;
```

Repository functions that may be called within transactions use `DBOrTransaction`:

```typescript
export async function softDeleteUserFiles(
    db: DBOrTransaction,
    userId: string,
    fileIds: string[]
): Promise<File[]> { ... }
```

## Consequences

### Positive

- Transaction type automatically matches the db instance configuration
- No additional imports needed from drizzle-orm
- Pattern is resilient to Drizzle ORM version updates
- Repository functions can be composed within transactions for atomic operations

### Negative

- The `Parameters<Parameters<...>>` pattern requires TypeScript familiarity
- IDE hover shows the extracted type, not a named type (minor)

### Notes

- This is a common pattern in the Drizzle community (see GitHub Discussion #3271)
- The Drizzle team has acknowledged this needs documentation
- Union types may resolve transaction parameters as `any` in edge cases, but this rarely affects typical CRUD operations

## Related

- [[decisions/_index|Back to ADRs]]
- [Drizzle GitHub Discussion #3271](https://github.com/drizzle-team/drizzle-orm/discussions/3271)
- [Drizzle GitHub Issue #2851](https://github.com/drizzle-team/drizzle-orm/issues/2851)
