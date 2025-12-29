---
title: Code Conventions
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - ai
  - conventions
  - standards
aliases:
  - Naming Conventions
  - Style Guide
ai_summary: "Naming, structure, and style rules for consistent code"
---

# Code Conventions

Naming conventions, file structure, and code style rules for the Nexus project.

## File Naming

| Type | Convention | Example |
|------|------------|---------|
| Components | `PascalCase.tsx` | `FileUploader.tsx` |
| Utilities | `camelCase.ts` | `formatBytes.ts` |
| Hooks | `useCamelCase.ts` | `useFileUpload.ts` |
| Actions | `camelCase.ts` | `uploadFile.ts` |
| Types | `camelCase.ts` | `fileTypes.ts` |
| Tests | `*.test.ts` / `*.spec.ts` | `formatBytes.test.ts` |

## Component Naming

```typescript
// ✅ Good - PascalCase, descriptive
export function FileUploader() {}
export function StorageTierBadge() {}
export function DashboardSidebar() {}

// ❌ Bad
export function fileUploader() {}  // lowercase
export function FU() {}            // abbreviation
export function Uploader() {}      // too generic
```

## Component Structure

Use `function` declarations for components instead of `const` arrow functions. This enables hoisting, which allows better file organization.

```typescript
// ✅ Good - function declaration
export function FileUploader() {
  return <div>...</div>;
}

// ❌ Avoid - const arrow function for components
export const FileUploader = () => {
  return <div>...</div>;
};
```

### File Organization

When components get large, split them into separate section files for readability. Use common sense - this isn't a strict rule.

When a component is large but can't or shouldn't be split, put the main export first. Helper components and utilities come after. Function hoisting makes this possible, letting readers understand the main logic before diving into details.

```typescript
// ✅ Good - main component first, helpers below
export function Dashboard() {
  const data = useDashboardData();

  return (
    <div>
      <Header />
      <StatsGrid data={data} />
      <RecentFiles />
    </div>
  );
}

// Helper components defined after - hoisting allows this
function Header() {
  return <header>...</header>;
}

function StatsGrid({ data }: StatsGridProps) {
  return <div>...</div>;
}

function RecentFiles() {
  return <section>...</section>;
}
```

## Function Naming

```typescript
// ✅ Good - camelCase, verb prefix
function uploadFile() {}
function getStorageTier() {}
function calculateUsage() {}
function handleFileSelect() {}
function formatBytes() {}

// ❌ Bad
function file_upload() {}   // snake_case
function FileUpload() {}    // PascalCase (for components)
function data() {}          // no verb, too generic
```

## Variable Naming

```typescript
// ✅ Good
const isUploading = true;
const fileCount = 5;
const currentUser = await getUser();
const storageUsageBytes = 1024;

// ❌ Bad
const uploading = true;     // missing 'is' prefix for boolean
const fc = 5;               // abbreviation
const data = await get();   // too generic
```

## TypeScript

### Prefer Interfaces for Objects
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

### Explicit Return Types
```typescript
// ✅ Good - explicit return for public functions
export function formatBytes(bytes: number): string {
  // ...
}

// ✅ OK - inferred for simple internal functions
const double = (n: number) => n * 2;
```

### Avoid `any`
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

## Props Interface
```typescript
// ✅ Good - named interface above component
interface FileCardProps {
  file: FileData;
  onDelete?: (id: string) => void;
}

export function FileCard({ file, onDelete }: FileCardProps) {
  // ...
}
```

## Comments

```typescript
// ✅ Good - explain WHY, not WHAT
// Using chunked upload to handle files > 5MB without timeout
await uploadChunked(file);

// ✅ Good - document non-obvious behavior
// Glacier retrieval can take 3-5 hours, notify user
await initiateRestore(fileId);

// ❌ Bad - obvious from code
// Set uploading to true
setIsUploading(true);
```

## Error Handling

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

- [[patterns|Code Patterns]] - Implementation examples
- [[context|Project Context]] - Background and architecture
- [[ai/_index|Back to AI Docs]]
