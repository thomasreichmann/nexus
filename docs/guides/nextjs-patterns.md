---
title: Next.js Patterns
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
    - guide
    - nextjs
    - patterns
aliases:
    - Implementation Guide
    - Next.js Implementation
---

# Next.js Patterns

Implementation patterns and best practices for the Nexus MVP.

## Version & Setup

- **Target Version:** Next.js 16
- **TypeScript:** Yes, strict mode
- **Package Manager:** pnpm
- **Router:** App Router
- **Bundler:** Turbopack (default)
- **React:** 19.2 with React Compiler

## Server Components Strategy

> [!important] Default to Server
> Use Server Components by default. Only use Client Components when you need interactivity.

### Server Component (default)

```typescript
// No 'use client' directive needed
export default async function FilesPage() {
  const files = await getFiles(); // Direct DB access
  return <FilesList files={files} />;
}
```

### Client Component (when needed)

```typescript
'use client';

export function UploadButton() {
    const [isUploading, setIsUploading] = useState(false);
    // ... interactive logic
}
```

**Use Client Components for:**

- `useState`, `useEffect`, or other React hooks
- Event handlers (`onClick`, `onChange`, etc.)
- Browser-only APIs
- Real-time subscriptions

## Data Fetching Patterns

### Parallel Data Fetching

```typescript
export default async function Dashboard() {
  // Fetch in parallel - much faster
  const [files, stats, usage] = await Promise.all([
    getFiles(),
    getStats(),
    getUsage()
  ]);

  return (
    <div>
      <Stats data={stats} />
      <Usage data={usage} />
      <FilesList files={files} />
    </div>
  );
}
```

### Streaming with Suspense

```typescript
import { Suspense } from 'react';

export default function Dashboard() {
  return (
    <div>
      <Suspense fallback={<StatsLoading />}>
        <Stats />
      </Suspense>
      <Suspense fallback={<FilesLoading />}>
        <FilesList />
      </Suspense>
    </div>
  );
}
```

## Server Actions

Use Server Actions for mutations:

```typescript
// actions/files.ts
'use server';

import { revalidatePath } from 'next/cache';

export async function deleteFile(fileId: string) {
    const supabase = createServerClient();

    await supabase.from('files').delete().eq('id', fileId);

    revalidatePath('/dashboard/files');
}
```

### Using in Components

```typescript
'use client';
import { deleteFile } from '@/actions/files';

export function DeleteButton({ fileId }: { fileId: string }) {
  return (
    <form action={() => deleteFile(fileId)}>
      <button type="submit">Delete</button>
    </form>
  );
}
```

## File Upload Implementation

### Chunked Upload Strategy

```typescript
// lib/upload.ts
export async function uploadLargeFile(
    file: File,
    onProgress: (progress: number) => void
) {
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(
            i * chunkSize,
            Math.min((i + 1) * chunkSize, file.size)
        );

        await uploadChunk(chunk, i, totalChunks);
        onProgress(((i + 1) / totalChunks) * 100);
    }
}
```

### API Route for Upload

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: NextRequest) {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    const s3 = new S3Client({ region: process.env.AWS_REGION });

    await s3.send(
        new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: `uploads/${file.name}`,
            Body: Buffer.from(await file.arrayBuffer()),
        })
    );

    return NextResponse.json({ success: true });
}
```

## Caching Strategy

Next.js 16 uses opt-in caching with the `"use cache"` directive. All dynamic code runs at request time by default.

### Cache Directive

```typescript
// Cache a function
async function getFiles() {
  "use cache";
  return await db.query.files.findMany();
}

// Cache a component
async function FileStats() {
  "use cache";
  const stats = await getStats();
  return <div>{stats.totalFiles} files</div>;
}
```

### Revalidation

```typescript
import { revalidatePath, revalidateTag } from 'next/cache';

// After data mutation
await uploadFile(file);
revalidatePath('/dashboard/files');
revalidateTag('user-files');
```

## Proxy for Auth

Next.js 16 replaces `middleware.ts` with `proxy.ts` for explicit network boundary control.

```typescript
// proxy.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(req: NextRequest) {
    const res = NextResponse.next();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                /* cookie config */
            },
        }
    );

    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
        return NextResponse.redirect(new URL('/login', req.url));
    }

    return res;
}

export const config = {
    matcher: ['/dashboard/:path*'],
};
```

## Performance Checklist

- Use Server Components by default
- Implement Suspense boundaries
- Optimize images with `next/image`
- Use dynamic imports for heavy components
- Implement proper caching strategies
- Use font optimization (`next/font`)
- Minimize client-side JavaScript
- Implement proper loading states
- Use streaming where possible

## Related

- [[getting-started|Getting Started]]
- [[tech-stack|Tech Stack]]
- [[system-design|System Design]]
- [[guides/_index|Back to Guides]]
