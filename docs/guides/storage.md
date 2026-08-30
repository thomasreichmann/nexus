---
title: S3 Storage Module
created: 2026-01-26
updated: 2026-01-26
status: active
tags:
    - guide
    - storage
    - s3
    - aws
aliases:
    - Storage Guide
    - S3 Guide
ai_summary: 'Usage guide for the S3 storage module API'
---

# S3 Storage Module

The storage module (`lib/storage/`) provides a structured API for all S3 operations in the app.

## Quick Start

```typescript
import { s3 } from '@/lib/storage';

// Generate a presigned upload URL
const uploadUrl = await s3.presigned.put('user/123/file.pdf', {
    contentType: 'application/pdf',
});

// Generate a presigned download URL
const downloadUrl = await s3.presigned.get('user/123/file.pdf', {
    filename: 'document.pdf',
});

// Ask S3 what the object can do right now
const state = await s3.glacier.getObjectState('user/123/archive.zip');
if (isReadable(state)) {
    console.log('Downloadable until:', state.expiresAt);
}

// Delete an object
await s3.objects.remove('user/123/old-file.txt');
```

## API Reference

### Presigned URLs

#### `s3.presigned.put(key, options?)`

Generate a presigned URL for uploading an object.

| Option          | Type     | Default | Description                     |
| --------------- | -------- | ------- | ------------------------------- |
| `contentType`   | `string` | -       | MIME type of the file           |
| `contentLength` | `number` | -       | Expected file size in bytes     |
| `expiresIn`     | `number` | 900     | URL expiration in seconds (15m) |

```typescript
const url = await s3.presigned.put('uploads/photo.jpg', {
    contentType: 'image/jpeg',
    expiresIn: 300, // 5 minutes
});
```

#### `s3.presigned.get(key, options?)`

Generate a presigned URL for downloading an object.

| Option      | Type     | Default | Description                         |
| ----------- | -------- | ------- | ----------------------------------- |
| `expiresIn` | `number` | 3600    | URL expiration in seconds (1 hour)  |
| `filename`  | `string` | -       | Download filename (sets attachment) |

```typescript
const url = await s3.presigned.get('files/report.pdf', {
    filename: 'Monthly Report.pdf',
    expiresIn: 7200, // 2 hours
});
```

### Derived Bucket (thumbnails)

Presigned reads against the Standard-class derived bucket
(`S3_DERIVED_BUCKET`), where the worker writes thumbnails (#350). Keys come
from `thumbnailKey()` in `@nexus/db/repo/files` — a pure function of the file
row, never stored.

#### `s3.derived.isConfigured()`

`true` when `S3_DERIVED_BUCKET` is set. The env var is optional (rollout
ordering); callers must gate on this and degrade to icon fallbacks.

#### `s3.derived.get(key, options?)`

| Option      | Type     | Default | Description                        |
| ----------- | -------- | ------- | ---------------------------------- |
| `expiresIn` | `number` | 3600    | URL expiration in seconds (1 hour) |

```typescript
if (s3.derived.isConfigured()) {
    const url = await s3.derived.get(thumbnailKey(file));
}
```

### Glacier Operations

#### There is no `s3.glacier.restore` here

`RestoreObject` is issued by the worker's `initiate-restore` handler, never
from the app (#423). The app decides _that_ a restore happens — it writes the
retrieval rows and publishes the job — and one place tells AWS. A 10,000-file
request is two S3 round trips per file, which is not something an HTTP handler
can wait for, and a second wrapper on this side would be a second way to start
a restore that nothing reconciles.

The tier a restore runs at is `DEFAULT_RESTORE_TIER` (`@nexus/db/objectState`)
unless the caller names one:

| Tier        | Deep Archive | Cost       | Use case                      |
| ----------- | ------------ | ---------- | ----------------------------- |
| `expedited` | unavailable  | Highest    | Glacier Flexible only         |
| `standard`  | 12-48 hrs    | $0.02/GB   | Upsell candidate, not default |
| `bulk`      | 48 hrs       | $0.0025/GB | **The default** (#406)        |

The `Days` a restore is kept comes from the retrieval row's
`restoreDaysToKeep`, written on the request path: a single-file restore is
downloaded from the thawed copy directly and buys
`DEFAULT_RESTORE_DAYS_TO_KEEP`; a multi-file restore is delivered as zip
artifacts whose own lifecycle rule owns the user-facing window, so it buys
`ZIP_BUILD_RESTORE_DAYS` — the thawed copies only have to outlive the build
(#424).

#### `s3.glacier.getObjectState(key)`

One `HeadObject`, answering both "what class is this in" and "is there a
restored copy". **This is how object state is read** — S3 owns it, and nothing
in the database mirrors it (#416, see `docs/ai/context.md`). Cheap enough to
call per user action: HEAD bills as a GET-class request ($0.0004 per 1,000),
is metadata-only, and costs the same for a Deep Archive object as a warm one.

Returns an `ObjectState`:

```typescript
type ObjectAvailability = 'warm' | 'archived' | 'restoring' | 'restored';

interface ObjectState {
    availability: ObjectAvailability;
    storageClass?: string; // Raw S3 value; absent for STANDARD
    expiresAt?: Date; // Only ever set for 'restored'
}
```

The header parsing lives in `@nexus/db/object-state` (`interpretObjectState`)
so the worker's retrieval poll reads the same headers the same way. Use
`isReadable(state)` rather than comparing states by hand.

```typescript
const state = await s3.glacier.getObjectState('archives/2024.zip');

switch (state.availability) {
    case 'warm':
        console.log('Readable as-is — no restore needed or possible');
        break;
    case 'archived':
        console.log('Cold; a retrieval request is what thaws it');
        break;
    case 'restoring':
        console.log('Restore underway, check back later');
        break;
    case 'restored':
        console.log('Ready! Expires:', state.expiresAt);
        break;
}
```

### Object Operations

#### `s3.objects.remove(key)`

Delete an object from the bucket. This operation is idempotent—it returns successfully even if the object doesn't exist.

```typescript
await s3.objects.remove('user/123/deleted-file.txt');
```

### Multipart Uploads

Large files (≥100 MB) upload in parts. The client PUTs each part to a presigned
URL, collects the ETags, and completes the upload. These operations back the
resumable-upload flow.

#### `s3.multipart.create(key, contentType?)`

Initiate a multipart upload. Returns `{ uploadId }` — required for every
subsequent part operation.

#### `s3.multipart.signParts(options)`

Presign URLs for **all** parts at once (`{ key, uploadId, partCount, expiresIn? }`).
Returns a `string[]` indexed by position (`partNumber - 1`). Used when starting a
fresh upload. Default expiry: 3600s (1 hour).

#### `s3.multipart.signPartsByNumber(options)`

Presign URLs for a **specific** set of part numbers
(`{ key, uploadId, partNumbers, expiresIn? }`). Returns `{ partNumber, url }[]`.
Use this to re-presign only the parts left to upload on resume, and to refresh
URLs that expired mid-upload — both without restarting the upload.

```typescript
const signed = await s3.multipart.signPartsByNumber({
    key,
    uploadId,
    partNumbers: [3, 4, 5], // only the missing parts
});
```

#### `s3.multipart.listParts(key, uploadId)`

List the parts S3 has already received. Returns
`{ partNumber, etag, size }[]`, paging through results automatically (S3 caps a
single response at 1000 parts; 10000 parts max per upload). This is the
authoritative source for resume reconciliation: it lets the client skip
already-uploaded parts even when its local state is stale or lost, and the
returned ETags feed straight back into `complete`.

#### `s3.multipart.complete(key, uploadId, parts)` / `s3.multipart.abort(key, uploadId)`

Finalize the upload with the collected `{ partNumber, etag }[]`, or abort to
discard all uploaded parts. Incomplete uploads that are never completed or
aborted are cleaned up by the bucket's `abort-incomplete-multipart` lifecycle
rule (7 days) — see `infra/terraform/s3.tf`.

## Types

All types are re-exported from the main module:

```typescript
import type {
    RestoreTier,
    ObjectState,
    ObjectAvailability,
    PutPresignOptions,
    GetPresignOptions,
} from '@/lib/storage';
```

## Error Handling

The module lets AWS SDK errors bubble up. Handle them in your service layer:

```typescript
import { S3ServiceException } from '@aws-sdk/client-s3';

try {
    await s3.glacier.getObjectState(key);
} catch (error) {
    if (error instanceof S3ServiceException) {
        if (error.name === 'NotFound') {
            throw new FileNotFoundError(key);
        }
    }
    throw error;
}
```

## Related

- [[../architecture/storage|Storage Architecture]]
- [[nextjs-patterns#presigned-uploads|Next.js Presigned Upload Pattern]]
