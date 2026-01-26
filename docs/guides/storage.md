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

// Start a Glacier restore
await s3.glacier.restore('user/123/archive.zip', 'standard');

// Check restore status
const status = await s3.glacier.checkStatus('user/123/archive.zip');
if (status.status === 'completed') {
    console.log('Restored until:', status.expiresAt);
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

### Glacier Operations

#### `s3.glacier.restore(key, tier, daysToKeep?)`

Start a restore operation for an object in Glacier Deep Archive.

| Parameter    | Type          | Default | Description                       |
| ------------ | ------------- | ------- | --------------------------------- |
| `key`        | `string`      | -       | S3 object key                     |
| `tier`       | `RestoreTier` | -       | Restore speed (see table below)   |
| `daysToKeep` | `number`      | 7       | Days to keep restored copy active |

**Restore Tiers:**

| Tier        | Time     | Cost     | Use Case              |
| ----------- | -------- | -------- | --------------------- |
| `expedited` | 1-5 min  | Highest  | Urgent access         |
| `standard`  | 3-5 hrs  | Moderate | Normal retrieval      |
| `bulk`      | 5-12 hrs | Lowest   | Large batch retrieval |

```typescript
// Standard restore, keep for 14 days
await s3.glacier.restore('archives/2024.zip', 'standard', 14);
```

#### `s3.glacier.checkStatus(key)`

Check the restore status of a Glacier object.

Returns a `RestoreStatus` object:

```typescript
interface RestoreStatus {
    status: 'not-started' | 'in-progress' | 'completed';
    expiresAt?: Date; // Only present when status === 'completed'
}
```

```typescript
const status = await s3.glacier.checkStatus('archives/2024.zip');

switch (status.status) {
    case 'not-started':
        console.log('No restore in progress');
        break;
    case 'in-progress':
        console.log('Restore underway, check back later');
        break;
    case 'completed':
        console.log('Ready! Expires:', status.expiresAt);
        break;
}
```

### Object Operations

#### `s3.objects.remove(key)`

Delete an object from the bucket. This operation is idempotent—it returns successfully even if the object doesn't exist.

```typescript
await s3.objects.remove('user/123/deleted-file.txt');
```

## Types

All types are re-exported from the main module:

```typescript
import type {
    RestoreTier,
    RestoreStatus,
    PutPresignOptions,
    GetPresignOptions,
} from '@/lib/storage';
```

## Error Handling

The module lets AWS SDK errors bubble up. Handle them in your service layer:

```typescript
import { S3ServiceException } from '@aws-sdk/client-s3';

try {
    await s3.glacier.checkStatus(key);
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
