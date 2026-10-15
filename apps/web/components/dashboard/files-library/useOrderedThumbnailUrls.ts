'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';
import type { File } from '@nexus/db/repo/files';

// Matches the getThumbnailUrls router input cap, and the batch pane's page.
const CHUNK_SIZE = 100;
const STALE_MS = 45 * 60 * 1000;

/** What fetching a thumbnail needs from a file. */
export type ThumbnailFile = Pick<File, 'id' | 'thumbnailStatus'>;

/**
 * Thumbnail URLs for files in display order, a 100-file chunk per query.
 * The library pages by appending (more batches), so chunks already fetched
 * keep their keys and their URLs: an image never re-mints and flashes
 * because a page was added after it.
 */
export function useOrderedThumbnailUrls(
    files: ThumbnailFile[]
): Record<string, string> {
    const chunks = useMemo(() => {
        const result: ThumbnailFile[][] = [];
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            result.push(files.slice(i, i + CHUNK_SIZE));
        }
        return result;
    }, [files]);
    return useThumbnailUrlsByPage(chunks);
}

/**
 * The same, one query per page the caller already has: an open batch's pages
 * load at either end (#455), so chunking the files flat would shift every
 * boundary when a page lands in front.
 */
export function useThumbnailUrlsByPage(
    pages: ThumbnailFile[][]
): Record<string, string> {
    const trpc = useTRPC();

    // Slice before filtering, so a chunk is a page whichever of its files
    // have thumbnails.
    const chunks = useMemo(
        () =>
            pages
                .map((page) =>
                    page
                        .filter((f) => f.thumbnailStatus === 'ready')
                        .map((f) => f.id)
                )
                .filter((ids) => ids.length > 0),
        [pages]
    );

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
