'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

// Matches the getThumbnailUrls router input cap, and the batch pane's page.
const CHUNK_SIZE = 100;
const STALE_MS = 45 * 60 * 1000;

/**
 * `useThumbnailUrls`, chunked in display order instead of sorted order. The
 * library pages by appending (more batches, the next 100 files), so chunks
 * already fetched keep their keys and their URLs: an image never re-mints
 * and flashes because a page was added after it.
 */
export function useOrderedThumbnailUrls(
    files: FileWithRetrieval[]
): Record<string, string> {
    const trpc = useTRPC();

    // Slice files before filtering, so a chunk boundary is a page boundary
    // whichever files on the page have thumbnails.
    const chunks = useMemo(() => {
        const result: string[][] = [];
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            const ids = files
                .slice(i, i + CHUNK_SIZE)
                .filter((f) => f.thumbnailStatus === 'ready')
                .map((f) => f.id);
            if (ids.length > 0) result.push(ids);
        }
        return result;
    }, [files]);

    return useQueries({
        queries: chunks.map((fileIds) => ({
            ...trpc.files.getThumbnailUrls.queryOptions({ fileIds }),
            staleTime: STALE_MS,
        })),
        // `combine` only re-runs when a result changes, so the merged map
        // keeps its identity across unrelated re-renders: memoized consumers
        // (the batch pane) can compare it by reference.
        combine: mergeUrls,
    });
}

function mergeUrls(
    results: { data?: { urls: Record<string, string> } }[]
): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const result of results) {
        if (result.data) Object.assign(merged, result.data.urls);
    }
    return merged;
}
