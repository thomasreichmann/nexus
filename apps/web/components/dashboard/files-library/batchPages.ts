import type { BatchFilesPage, LibraryFile } from '@nexus/db/repo/library';

/*
 * The pages an open batch has loaded, scope by scope: the whole batch when
 * it's flat, or each expanded folder of one with structure inside (#405).
 * Each page is its own query, keyed by the cursor that asked for it, so a
 * page refetched by a poll or an invalidation keeps its place and nothing
 * already loaded re-fetches when a page is added at either end.
 */

/** How one page was asked for, as the `files.listBatchFiles` input takes it. */
export interface PageRequest {
    cursor?: string;
    direction?: 'backward';
}

/**
 * A scope's first page: the start, or the page holding a deep-linked file,
 * asked for by the file that starts it (`files.locate`'s `pageStartId`). A
 * page boundary rather than the file itself, so the page a refetch returns
 * is the one the user is on, and paging back from it meets the page before.
 */
export function firstPages(pageStartId?: string): PageRequest[] {
    return [pageStartId ? { cursor: pageStartId } : {}];
}

/** The requests with the page after the last loaded one appended. */
export function withNextPage(
    requests: PageRequest[],
    last: BatchFilesPage | undefined
): PageRequest[] {
    if (!last?.nextCursor) return requests;
    const cursor = last.nextCursor;
    if (requests.some((r) => r.cursor === cursor && !r.direction))
        return requests;
    return [...requests, { cursor }];
}

/** The requests with the page before the first loaded one prepended. */
export function withPreviousPage(
    requests: PageRequest[],
    first: BatchFilesPage | undefined
): PageRequest[] {
    if (!first?.previousCursor) return requests;
    const cursor = first.previousCursor;
    if (requests.some((r) => r.cursor === cursor && r.direction))
        return requests;
    return [{ cursor, direction: 'backward' }, ...requests];
}

export interface ScopeFiles {
    files: LibraryFile[];
    /**
     * The same files, page by page: thumbnail URLs are fetched a page at a
     * time, so a page added at either end never re-keys the ones loaded.
     */
    pageFiles: LibraryFile[][];
    /** Each loaded file's place among the scope's files. */
    positions: Map<string, number>;
    /** Files in the scope, as the latest page to answer counted them. */
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
    /** A page asked for hasn't answered yet. */
    isLoading: boolean;
}

/**
 * One scope's files from its pages, in order. Pages can overlap: a file
 * deleted from one page pulls the next page's first file into it on
 * refetch, while the next page still holds it. Each file shows once, at
 * its first page.
 */
export function assembleScope(
    pages: (BatchFilesPage | undefined)[]
): ScopeFiles {
    const pageFiles: LibraryFile[][] = [];
    const positions = new Map<string, number>();
    let total = 0;
    for (const page of pages) {
        if (!page) continue;
        total = page.total;
        const fresh: LibraryFile[] = [];
        page.files.forEach((file, i) => {
            if (positions.has(file.id)) return;
            positions.set(file.id, page.startIndex + i);
            fresh.push(file);
        });
        pageFiles.push(fresh);
    }
    // The edges of what's loaded: a page on its way past one still leaves
    // files out there, so the pager and the viewer's gap hold while it loads.
    const answered = pages.filter((page) => page !== undefined);
    return {
        files: pageFiles.flat(),
        pageFiles,
        positions,
        total,
        hasPrevious: !!answered[0]?.previousCursor,
        hasNext: !!answered.at(-1)?.nextCursor,
        isLoading: pages.some((page) => !page),
    };
}
