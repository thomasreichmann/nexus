'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

// Matches the getThumbnailUrls router input cap.
const BATCH_SIZE = 100;
// Presigned URLs live 1 hour; refetch comfortably before expiry. Session-
// level caching only (TanStack Query) — signatures embed timestamps, so URLs
// are unique per mint and browser-cache reuse across mints isn't a goal.
const STALE_MS = 45 * 60 * 1000;

/**
 * Bulk-fetch presigned thumbnail URLs for the given files, in page-sized
 * chunks. Returns a fileId -> URL map; files without a ready thumbnail are
 * absent (callers keep their icon fallback).
 */
export function useThumbnailUrls(
    files: FileWithRetrieval[]
): Record<string, string> {
    const trpc = useTRPC();

    // Sorted ids -> stable chunk boundaries -> stable query keys, so
    // reordering or regrouping upstream never busts the session cache.
    const chunks = useMemo(() => {
        const ids = files
            .filter((f) => f.thumbnailStatus === 'ready')
            .map((f) => f.id)
            .sort();
        const result: string[][] = [];
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            result.push(ids.slice(i, i + BATCH_SIZE));
        }
        return result;
    }, [files]);

    const results = useQueries({
        queries: chunks.map((fileIds) => ({
            ...trpc.files.getThumbnailUrls.queryOptions({ fileIds }),
            staleTime: STALE_MS,
        })),
    });

    // Plain merge per render: consumers read individual string values, so
    // map identity doesn't matter, and the copy is cheap at library scale.
    const merged: Record<string, string> = {};
    for (const result of results) {
        if (result.data) Object.assign(merged, result.data.urls);
    }
    return merged;
}
