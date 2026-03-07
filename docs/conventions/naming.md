---
title: Naming Conventions
created: 2026-03-07
updated: 2026-03-07
status: active
tags:
    - conventions
    - naming
aliases:
    - Naming Guide
---

# Naming Conventions

Detailed naming rules with examples for the Nexus project.

## File Naming

| Type       | Convention                | Example               |
| ---------- | ------------------------- | --------------------- |
| Components | `PascalCase.tsx`          | `FileUploader.tsx`    |
| Utilities  | `camelCase.ts`            | `formatBytes.ts`      |
| Hooks      | `useCamelCase.ts`         | `useFileUpload.ts`    |
| Actions    | `camelCase.ts`            | `uploadFile.ts`       |
| Types      | `camelCase.ts`            | `fileTypes.ts`        |
| Tests      | `*.test.ts` / `*.spec.ts` | `formatBytes.test.ts` |

## Component Naming

```typescript
// ✅ Good - PascalCase, descriptive
export function FileUploader() {}
export function StorageTierBadge() {}
export function DashboardSidebar() {}

// ❌ Bad
export function fileUploader() {} // lowercase
export function FU() {} // abbreviation
export function Uploader() {} // too generic
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
function file_upload() {} // snake_case
function FileUpload() {} // PascalCase (for components)
function data() {} // no verb, too generic
```

## Variable Naming

```typescript
// ✅ Good
const isUploading = true;
const fileCount = 5;
const currentUser = await getUser();
const storageUsageBytes = 1024;

// ❌ Bad
const uploading = true; // missing 'is' prefix for boolean
const fc = 5; // abbreviation
const data = await get(); // too generic
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

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
