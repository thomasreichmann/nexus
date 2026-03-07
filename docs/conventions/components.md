---
title: Component Conventions
created: 2026-03-07
updated: 2026-03-07
status: active
tags:
    - conventions
    - components
    - react
aliases:
    - Component Guide
---

# Component Conventions

## Function Declarations

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

## File Organization

When components get large, split them into separate section files for readability.

When a component is large but can't or shouldn't be split, put the main export first. Helper components and utilities come after. Function hoisting makes this possible.

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

## Related

- [[../ai/conventions|Conventions (AI)]] - Summary reference
