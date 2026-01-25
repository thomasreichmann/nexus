---
title: Logging
created: 2026-01-25
updated: 2026-01-25
status: active
tags:
    - guide
    - logging
    - observability
aliases:
    - Logging Guide
---

# Logging

Nexus uses a dual-logger architecture with [pino](https://getpino.io/) for both server and client-side logging.

## Overview

| Logger | Import | Environment | Output |
|--------|--------|-------------|--------|
| Server | `@/server/lib/logger` | Server-side only | Terminal (pretty in dev, JSON in prod) |
| Client | `@/lib/logger` | Client-side only | Dev: transmitted to terminal via `/api/dev-log` |

## Server Logger

The server logger (`@/server/lib/logger`) is used in server components, API routes, tRPC procedures, and server-side utilities.

### Usage

```typescript
import { logger } from '@/server/lib/logger';

// Basic logging
logger.info('Server started');
logger.error({ err }, 'Database connection failed');

// With context
logger.info({ userId, action: 'upload' }, 'File uploaded');
```

### Configuration

- **Development:** Uses `pino-pretty` for colorized, human-readable output
- **Production:** JSON output for structured log aggregation
- **Level:** `debug` in dev, `info` in prod

### tRPC Integration

In tRPC procedures, use the request-scoped logger from context:

```typescript
export const fileRouter = router({
    upload: protectedProcedure.mutation(async ({ ctx }) => {
        ctx.log.setField('fileSize', size);
        ctx.log.timed('s3Upload', async () => {
            // ...
        });
    }),
});
```

See [[server-architecture#Logging|Server Architecture - Logging]] for the wide events pattern.

## Client Logger

The client logger (`@/lib/logger`) provides the same pino API for client-side code.

### Usage

```typescript
import { log } from '@/lib/logger';

// Same API as server
log.info('Button clicked');
log.error({ err }, 'Failed to load data');
log.debug({ component: 'FileList' }, 'Rendering');
```

### How It Works

1. Client code calls `log.info()`, `log.error()`, etc.
2. In development, logs are transmitted via POST to `/api/dev-log`
3. The endpoint forwards logs to the server logger with `[client]` prefix
4. In production, only `warn` and above are logged (no transmission)

### SSR Limitation

The client logger is **disabled during SSR** to prevent duplicate logs.

```typescript
// In lib/logger/client.ts
export const log = pino({
    // ...
    enabled: typeof window !== 'undefined',
});
```

**Why:** `'use client'` marks the hydration boundary but doesn't prevent server-side execution. Without this guard, log calls in client components would run twice:
1. During SSR (server) - pino outputs raw JSON to terminal
2. During hydration (browser) - pino transmits to `/api/dev-log`

When `enabled: false`, pino becomes a noop - all log methods do nothing.

## When to Use Which

| Scenario | Logger |
|----------|--------|
| API routes, tRPC procedures | Server (`@/server/lib/logger`) |
| Server components | Server (`@/server/lib/logger`) |
| Client components (`'use client'`) | Client (`@/lib/logger`) |
| Shared utilities | Depends on where they run |

## Related

- [[server-architecture|Server Architecture]] - tRPC logging middleware
- [[../ai/changelog|Changelog]] - Implementation history (#8, #9)
