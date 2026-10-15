'use client';

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { deriveStatus } from '@/components/dashboard/file-browser/status';
import { FILE_PAGE_SIZE } from '@/lib/library/paging';
import { useTRPC } from '@/lib/trpc/client';
import { getLivePollOptionsWhile } from '@/lib/trpc/polling';
import {
    assembleScope,
    firstPages,
    withNextPage,
    withPreviousPage,
    type PageRequest,
    type ScopeFiles,
} from './batchPages';
import type {
    BatchFilesPage,
    LibraryBatch,
    LibraryFile,
    LibraryFolder,
} from '@nexus/db/repo/library';

/** The section a flat batch lists all its files in. */
const WHOLE_BATCH = '*';

/** One block of the open batch: the whole of a flat one, or one folder. */
export interface BatchSection extends ScopeFiles {
    key: string;
    /** Null for a flat batch's single section. */
    folder: LibraryFolder | null;
    isExpanded: boolean;
    /** A page asked for failed, after its retries: the pane offers another. */
    isError: boolean;
}

export interface BatchFiles {
    sections: BatchSection[];
    /** The loaded files of every expanded section, in display order. */
    files: LibraryFile[];
    /** The section a loaded file shows in, and its place there. */
    locate(fileId: string): { section: BatchSection; index: number } | null;
    loadNext(sectionKey: string): void;
    loadPrevious(sectionKey: string): void;
    toggleFolder(sectionKey: string): void;
    /** Asks again for the section's pages that failed. */
    retry(sectionKey: string): void;
}

/**
 * A deep-linked file to open at: the folder it sits in, and the file that
 * starts its page (`files.locate`), which the pane's first page loads from.
 */
export interface BatchAnchor {
    fileId: string;
    subpath: string | null;
    pageStartId: string;
}

interface BatchFilesInput extends PageRequest {
    batchId: string | null;
    folder?: string | null;
    search?: string;
    limit: number;
}

interface PageResult {
    data: BatchFilesPage | undefined;
    isError: boolean;
    refetch: () => unknown;
}

interface UseBatchFilesOptions {
    /** The open batch, once loaded; its folders decide the sections. */
    batch: LibraryBatch | null | undefined;
    /** Set when the batch shows only its search matches. */
    search: string | undefined;
    anchor: BatchAnchor | null;
}

interface Scope {
    key: string;
    folder: LibraryFolder | null;
}

function scopesOf(batch: LibraryBatch): Scope[] {
    if (!batch.folders) return [{ key: WHOLE_BATCH, folder: null }];
    return batch.folders.map((folder) => ({
        key: folder.subpath ?? '',
        folder,
    }));
}

function isAnchorIn(scope: Scope, anchor: BatchAnchor | null): boolean {
    if (!anchor) return false;
    return scope.folder === null || scope.folder.subpath === anchor.subpath;
}

/**
 * The `files.listBatchFiles` input for one page of one section. Shared with
 * the library's prefetch, so a batch hovered before it's opened lands in
 * exactly the cache entry the pane reads.
 */
export function batchFilesInput(
    batch: Pick<LibraryBatch, 'batchId'>,
    folder: LibraryFolder | null,
    search: string | undefined,
    request: PageRequest = {}
): BatchFilesInput {
    return {
        batchId: batch.batchId,
        ...(folder && { folder: folder.subpath }),
        ...(search && { search }),
        limit: FILE_PAGE_SIZE,
        ...request,
    };
}

/** The section a freshly opened batch shows expanded, for the prefetch. */
export function firstFolderOf(batch: LibraryBatch): LibraryFolder | null {
    return batch.folders?.[0] ?? null;
}

const pollWhileRetrieving = getLivePollOptionsWhile<BatchFilesPage>(
    (page) =>
        page?.files.some((file) => deriveStatus(file) === 'retrieving') ?? false
);

/**
 * The open batch's files, loaded a page at a time per section (#455). A flat
 * batch is one section; one with structure inside (#405) has a section per
 * folder, collapsed except the first (or the one a deep link points into),
 * and a collapsed folder loads nothing.
 */
export function useBatchFiles({
    batch,
    search,
    anchor,
}: UseBatchFilesOptions): BatchFiles {
    const trpc = useTRPC();

    // Which pages each section has asked for, and which sections are
    // expanded (null until the user toggles one: the defaults apply). Both
    // start over for another batch, search or deep link.
    const identity = [batch?.batchId, search, anchor?.fileId].join('\0');
    const [state, setState] = useState<{
        identity: string;
        pages: Record<string, PageRequest[]>;
        expanded: Set<string> | null;
    }>({ identity, pages: {}, expanded: null });
    if (state.identity !== identity) {
        setState({ identity, pages: {}, expanded: null });
    }

    // Which sections show, and which pages each has asked for. Memoized, like
    // everything below, so the memoized pane only re-renders when its files
    // do: the viewer re-renders this component on every animation frame.
    const plan = useMemo(() => {
        const scopes = batch ? scopesOf(batch) : [];
        const expanded =
            state.expanded ??
            new Set(
                [
                    scopes.find((s) => isAnchorIn(s, anchor)) ?? scopes[0],
                ].flatMap((s) => (s ? [s.key] : []))
            );
        const requests = new Map(
            scopes
                .filter((s) => expanded.has(s.key))
                .map((scope) => [
                    scope.key,
                    state.pages[scope.key] ??
                        firstPages(
                            isAnchorIn(scope, anchor)
                                ? anchor!.pageStartId
                                : undefined
                        ),
                ])
        );
        return { scopes, expanded, requests };
    }, [batch, state, anchor]);

    const pageResults = useQueries({
        queries: batch
            ? plan.scopes.flatMap((scope) =>
                  (plan.requests.get(scope.key) ?? []).map((request) =>
                      trpc.files.listBatchFiles.queryOptions(
                          batchFilesInput(batch, scope.folder, search, request),
                          pollWhileRetrieving
                      )
                  )
              )
            : [],
        combine: pickResults,
    });

    // The queries ran section by section, so each section's pages are the
    // next slice of the results.
    const resultsBySection = useMemo(() => {
        const bySection = new Map<string, PageResult[]>();
        let offset = 0;
        for (const [key, requests] of plan.requests) {
            bySection.set(
                key,
                pageResults.slice(offset, offset + requests.length)
            );
            offset += requests.length;
        }
        return bySection;
    }, [plan, pageResults]);

    const sections = useMemo(
        () =>
            plan.scopes.map((scope): BatchSection => {
                const results = resultsBySection.get(scope.key);
                const folder = scope.folder;
                if (!results) {
                    return {
                        ...assembleScope([]),
                        total: folder?.matchCount ?? folder?.fileCount ?? 0,
                        key: scope.key,
                        folder,
                        isExpanded: false,
                        isError: false,
                    };
                }
                // A failed page isn't loading: it waits for a retry.
                const isError = results.some((r) => r.isError && !r.data);
                return {
                    ...assembleScope(results.map((r) => r.data)),
                    isLoading: results.some((r) => !r.data && !r.isError),
                    key: scope.key,
                    folder,
                    isExpanded: true,
                    isError,
                };
            }),
        [plan, resultsBySection]
    );
    const files = useMemo(() => sections.flatMap((s) => s.files), [sections]);

    // From the latest requests, not this render's: a load at each end in one
    // tick (the viewer's prefetch) must keep both.
    const updatePages = (
        sectionKey: string,
        update: (
            requests: PageRequest[],
            pages: (BatchFilesPage | undefined)[]
        ) => PageRequest[]
    ) => {
        const initial = plan.requests.get(sectionKey);
        const results = resultsBySection.get(sectionKey);
        if (!initial || !results) return;
        const pages = results.map((r) => r.data);
        setState((prev) => {
            if (prev.identity !== identity) return prev;
            const requests = prev.pages[sectionKey] ?? initial;
            const next = update(requests, pages);
            if (next === requests) return prev;
            return { ...prev, pages: { ...prev.pages, [sectionKey]: next } };
        });
    };

    return {
        sections,
        files,
        locate(fileId) {
            for (const section of sections) {
                const index = section.positions.get(fileId);
                if (index !== undefined) return { section, index };
            }
            return null;
        },
        loadNext: (key) =>
            updatePages(key, (requests, pages) =>
                withNextPage(requests, pages.at(-1))
            ),
        loadPrevious: (key) =>
            updatePages(key, (requests, pages) =>
                withPreviousPage(requests, pages[0])
            ),
        toggleFolder(key) {
            setState((prev) => {
                if (prev.identity !== identity) return prev;
                const next = new Set(prev.expanded ?? plan.expanded);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return { ...prev, expanded: next };
            });
        },
        retry(key) {
            for (const result of resultsBySection.get(key) ?? []) {
                if (result.isError && !result.data) void result.refetch();
            }
        },
    };
}

function pickResults(
    results: {
        data?: BatchFilesPage;
        isError: boolean;
        refetch: () => unknown;
    }[]
): PageResult[] {
    return results.map(({ data, isError, refetch }) => ({
        data,
        isError,
        refetch,
    }));
}
