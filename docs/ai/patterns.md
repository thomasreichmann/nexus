---
title: Code Patterns
created: 2025-12-29
updated: 2026-01-25
status: active
tags:
    - ai
    - patterns
    - code
aliases:
    - Implementation Patterns
    - Code Examples
ai_summary: 'Established code patterns for the Nexus project'
---

# Code Patterns

Implementation patterns for the Nexus project.

## Logging

Dual-logger architecture with pino for server and client.

### Server

```typescript
import { logger } from '@/server/lib/logger';

logger.info({ userId }, 'User logged in');
logger.error({ err }, 'Database query failed');
```

### Client

```typescript
import { log } from '@/lib/logger';

log.info('Button clicked');
log.error({ err }, 'Failed to fetch data');
```

**Key details:**
- Client logger is disabled during SSR (`enabled: typeof window !== 'undefined'`)
- Dev only: client logs transmit to `/api/dev-log` and appear in terminal with `[client]` prefix
- Same pino API on both sides

See [[../guides/logging|Logging Guide]] for full documentation.

## General Guidelines

When generating code:

- Follow the naming conventions in [[conventions|Conventions]]
- Check existing code for established patterns
- Prefer simple, readable solutions
- Be consistent with what already exists in the codebase

## Related

- [[conventions|Code Conventions]] - Naming and style rules
- [[context|Project Context]] - Background and architecture
- [[ai/_index|Back to AI Docs]]
