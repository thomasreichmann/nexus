---
title: TypeScript Conventions
created: 2026-03-07
updated: 2026-03-07
status: active
tags:
    - conventions
    - typescript
aliases:
    - TypeScript Guide
---

# TypeScript Conventions

## Prefer Interfaces for Objects

```typescript
// ✅ Good
interface User {
    id: string;
    email: string;
    createdAt: Date;
}

// Use type for unions, primitives
type StorageTier = 'standard' | 'glacier' | 'deep-archive';
type FileId = string;
```

## Explicit Return Types

```typescript
// ✅ Good - explicit return for public functions
export function formatBytes(bytes: number): string {
    // ...
}

// ✅ OK - inferred for simple internal functions
const double = (n: number) => n * 2;
```

## Avoid `any`

```typescript
// ✅ Good
function processData(data: unknown): void {}
function handleError(error: Error): void {}

// ❌ Bad
function processData(data: any): void {}
```

## Import Order

```typescript
// 1. React/Next.js
import { useState } from 'react';
import { NextRequest } from 'next/server';

// 2. External libraries
import { z } from 'zod';
import { format } from 'date-fns';

// 3. Internal aliases (@/)
import { Button } from '@/components/ui/button';
import { uploadFile } from '@/actions/files';

// 4. Relative imports
import { FileIcon } from './file-icon';
import type { FileData } from './types';

// 5. Types (if separate)
import type { User } from '@/types';
```

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
