import { describe, expect, it } from 'vitest';
import {
    assembleScope,
    firstPages,
    withNextPage,
    withPreviousPage,
    type PageRequest,
} from './batchPages';
import type { BatchFilesPage, LibraryFile } from '@nexus/db/repo/library';

const file = (id: string): LibraryFile => ({
    id,
    batchId: 'batch-1',
    name: `${id}.jpg`,
    subpath: null,
    size: 100,
    mimeType: 'image/jpeg',
    status: 'available',
    thumbnailStatus: 'pending',
    thumbnailWidth: null,
    thumbnailHeight: null,
    durationSeconds: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    activeRetrieval: null,
});

const page = (
    ids: string[],
    startIndex: number,
    extra: Partial<BatchFilesPage> = {}
): BatchFilesPage => ({
    files: ids.map(file),
    startIndex,
    total: 10,
    nextCursor: null,
    previousCursor: null,
    ...extra,
});

describe('firstPages', () => {
    it('starts at the beginning, or at the file that starts a deep link’s page', () => {
        expect(firstPages()).toEqual([{}]);
        expect(firstPages('f-7')).toEqual([{ cursor: 'f-7' }]);
    });
});

describe('withNextPage / withPreviousPage', () => {
    it('appends the page after the last one from its cursor', () => {
        const requests = withNextPage(
            [{}],
            page(['a', 'b'], 0, { nextCursor: 'c' })
        );

        expect(requests).toEqual([{}, { cursor: 'c' }]);
    });

    it('prepends the page before the first one, read backward', () => {
        const requests = withPreviousPage(
            [{ cursor: 'f' }],
            page(['f', 'g'], 5, { previousCursor: 'f' })
        );

        expect(requests).toEqual([
            { cursor: 'f', direction: 'backward' },
            { cursor: 'f' },
        ]);
    });

    // A deep link two pages in: "Show earlier files" twice walks back twice.
    it('pages back again past a page it already paged back to', () => {
        const once: PageRequest[] = [
            { cursor: 'k', direction: 'backward' },
            { cursor: 'k' },
        ];

        expect(
            withPreviousPage(once, page(['f', 'g'], 5, { previousCursor: 'f' }))
        ).toEqual([{ cursor: 'f', direction: 'backward' }, ...once]);
    });

    it('asks for nothing past either end, or for a page still loading', () => {
        const requests = [{}];

        expect(withNextPage(requests, page(['a'], 0))).toBe(requests);
        expect(withPreviousPage(requests, page(['a'], 0))).toBe(requests);
        expect(withNextPage(requests, undefined)).toBe(requests);
        expect(withPreviousPage(requests, undefined)).toBe(requests);
    });

    // A double click on "Show next" while the page is on its way.
    it('never asks for the same page twice, either way', () => {
        const last = page(['a'], 0, { nextCursor: 'b' });
        const first = page(['f'], 5, { previousCursor: 'f' });
        const next = withNextPage([{}], last);
        const previous = withPreviousPage([{}], first);

        expect(withNextPage(next, last)).toBe(next);
        expect(withPreviousPage(previous, first)).toBe(previous);
    });

    // The same cursor read the other way is another page: forward from `f`
    // starts at it, backward ends just before it.
    it('tells a page before a cursor from the page starting at it', () => {
        const first = page(['f'], 5, { previousCursor: 'f' });
        const last = page(['e'], 4, { nextCursor: 'f' });
        const before = { cursor: 'f', direction: 'backward' as const };

        expect(withPreviousPage([{ cursor: 'f' }], first)).toEqual([
            before,
            { cursor: 'f' },
        ]);
        expect(withNextPage([before], last)).toEqual([before, { cursor: 'f' }]);
    });
});

describe('assembleScope', () => {
    it('joins the pages in order, each file at its place in the scope', () => {
        const scope = assembleScope([
            page(['e', 'f'], 4, { previousCursor: 'e' }),
            page(['g', 'h'], 6, { nextCursor: 'i' }),
        ]);

        expect(scope.files.map((f) => f.id)).toEqual(['e', 'f', 'g', 'h']);
        expect(Object.fromEntries(scope.positions)).toEqual({
            e: 4,
            f: 5,
            g: 6,
            h: 7,
        });
        expect(scope).toMatchObject({
            total: 10,
            hasPrevious: true,
            hasNext: true,
            isLoading: false,
        });
    });

    // A file deleted from the first page pulls the next page's first file
    // into it on refetch, while the next page, not refetched yet, still
    // starts with it.
    it('shows a file two overlapping pages both hold once, at its first page', () => {
        const scope = assembleScope([page(['a', 'c'], 0), page(['c', 'd'], 2)]);

        expect(scope.files.map((f) => f.id)).toEqual(['a', 'c', 'd']);
        expect(scope.positions.get('c')).toBe(1);
        expect(scope.pageFiles.map((p) => p.map((f) => f.id))).toEqual([
            ['a', 'c'],
            ['d'],
        ]);
    });

    // "Show next" stays up, loading, and the viewer still knows the step
    // past its last loaded file waits on a page rather than ending there.
    it('is loading while a page asked for hasn’t answered, and keeps the edge it fills', () => {
        const scope = assembleScope([
            undefined,
            page(['c'], 2, { previousCursor: 'c', nextCursor: 'd' }),
            undefined,
        ]);

        expect(scope).toMatchObject({
            isLoading: true,
            hasPrevious: true,
            hasNext: true,
        });
        expect(scope.files.map((f) => f.id)).toEqual(['c']);
    });

    it('has no edges while its only page is on its way', () => {
        expect(assembleScope([undefined])).toMatchObject({
            isLoading: true,
            hasPrevious: false,
            hasNext: false,
        });
    });

    // Its edges are read off its ends: the first page's way back, the last
    // page's way on, whatever the pages between say.
    it('has a next page only when its last page says so', () => {
        const scope = assembleScope([
            page(['a'], 0, { nextCursor: 'b' }),
            page(['b'], 1, { nextCursor: 'c' }),
            page(['c'], 2),
        ]);

        expect(scope.hasNext).toBe(false);
    });

    it('is empty, with no edges, before anything is asked for', () => {
        expect(assembleScope([])).toMatchObject({
            files: [],
            total: 0,
            hasPrevious: false,
            hasNext: false,
            isLoading: false,
        });
    });

    it('counts the scope from the latest page to answer', () => {
        const scope = assembleScope([
            page(['a'], 0, { total: 10 }),
            page(['b'], 1, { total: 9 }),
        ]);

        expect(scope.total).toBe(9);
    });
});
