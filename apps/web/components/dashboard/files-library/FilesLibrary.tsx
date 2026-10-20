'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Snowflake } from 'lucide-react';
import {
    keepPreviousData,
    skipToken,
    useInfiniteQuery,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
    FileConfirmDialogs,
    useFileActions,
    type ActionableFile,
    type FileAction,
    type FileConfirm,
} from '@/components/dashboard/file-browser/FileActions';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { BATCH_PAGE_SIZE } from '@/lib/library/paging';
import {
    readRememberedViewMode,
    rememberViewMode,
} from '@/lib/library/viewMode';
import { useTRPC } from '@/lib/trpc/client';
import { getLivePollOptionsWhile } from '@/lib/trpc/polling';
import { BatchPane, type PaneSelection, type PaneViewMode } from './BatchPane';
import { BatchSplitView } from './BatchSplitView';
import { FileViewer, type ViewerPhase, type ViewerPlace } from './FileViewer';
import { LibraryHeading, LibraryView } from './LibraryView';
import { SelectionBar } from './SelectionBar';
import {
    batchIdOf,
    batchKeyOf,
    toBatchView,
    type BatchView,
} from './batchSummary';
import {
    createBatchTransitions,
    type BatchTransitions,
} from './batchTransition';
import {
    batchFilesInput,
    firstFolderOf,
    useBatchFiles,
    type BatchAnchor,
} from './useBatchFiles';
import {
    useOrderedThumbnailUrls,
    useThumbnailUrlsByPage,
} from './useOrderedThumbnailUrls';
import { useStableCallback } from './useStableCallback';
import type { LibraryBatch, LibraryFile } from '@nexus/db/repo/library';

const SEARCH_DEBOUNCE_MS = 300;
const NO_COUNTS = { archived: 0, retrieving: 0, available: 0 };
const NO_SELECTION: PaneSelection = { isWholeBatch: false, files: new Map() };
// The viewer asks for a section's next page this close to its loaded edge,
// so browsing a long batch file by file never waits on one.
const PREFETCH_EDGE = 10;

/*
 * `library` and `split` are at rest. The others are mid-choreography: React
 * renders both views (or the outgoing and incoming pane) and the transition
 * engine animates between them, then settles the phase.
 */
type Phase =
    | 'library'
    | 'opening'
    | 'split'
    | 'switching-out'
    | 'switching-in'
    | 'closing';

interface ViewState {
    phase: Phase;
    key: string | null;
    /** Set while switching out: the batch the pane re-deals to. */
    nextKey?: string;
}

const pollWhileBatchesRestore = getLivePollOptionsWhile<{
    pages: { batches: { restoringCount: number }[] }[];
}>(
    (data) =>
        data?.pages.some((page) =>
            page.batches.some((batch) => batch.restoringCount > 0)
        ) ?? false
);
const pollWhileBatchRestores = getLivePollOptionsWhile<LibraryBatch | null>(
    (batch) => (batch?.restoringCount ?? 0) > 0
);

/**
 * The #455 file browser: a library of batch cards that opens into a batch
 * list + batch pane, with the motion study's choreography between them. The
 * library loads as keyset-paged summaries from the server, and an open
 * batch's files a page at a time, folder by folder when it has structure
 * inside (#405), so nothing here grows with the size of the library.
 *
 * The URL is the source of truth for which batch is open — `?batch=<key>`, or
 * `?file=<id>` from a retrieval-ready email — so the browser's back button
 * closes a batch like "All batches" does.
 */
interface FilesLibraryProps {
    /** The grid/list choice remembered in this browser (#408). */
    initialViewMode: PaneViewMode;
}

export function FilesLibrary({ initialViewMode }: FilesLibraryProps) {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();

    const { data: countsData } = useQuery(
        trpc.files.statusCounts.queryOptions(
            undefined,
            getLivePollOptionsWhile((counts) => (counts?.retrieving ?? 0) > 0)
        )
    );
    const counts = countsData ?? NO_COUNTS;

    const [search, setSearch] = useState('');
    const activeSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
    const searchInput = activeSearch || undefined;

    // The library, a page of cards at a time. A new search keeps showing the
    // old results until its own land, rather than flashing empty.
    const batchesQuery = useInfiniteQuery(
        trpc.files.listBatches.infiniteQueryOptions(
            { search: searchInput, limit: BATCH_PAGE_SIZE },
            {
                getNextPageParam: (page) => page.nextCursor ?? undefined,
                placeholderData: keepPreviousData,
                ...pollWhileBatchesRestore,
            }
        )
    );
    const batchPages = batchesQuery.data?.pages;
    const batches = useMemo(
        () =>
            batchPages?.flatMap((page) => page.batches.map(toBatchView)) ?? [],
        [batchPages]
    );
    const totalBatchCount = batchPages?.[0]?.total ?? batches.length;
    const isSearching = batchesQuery.isPlaceholderData;

    // The stats line counts the whole library, searching or not: remember
    // the count the last unsearched page reported.
    const [libraryBatchCount, setLibraryBatchCount] = useState<number | null>(
        null
    );
    const unsearchedTotal =
        !searchInput && !isSearching ? batchPages?.[0]?.total : undefined;
    if (unsearchedTotal != null && unsearchedTotal !== libraryBatchCount) {
        setLibraryBatchCount(unsearchedTotal);
    }

    // A `?file=` this page has to find before it can open it: the one it
    // landed on, or one Back/Forward brought back that isn't loaded. The
    // server says which batch and folder it sits in, and the pane opens at
    // the page holding it. Asked once: the answer anchors the pane's pages,
    // and a refetch moving it (the file deleted since) would reset them.
    const batchParam = searchParams.get('batch');
    const fileParam = searchParams.get('file');
    const [landingFileId, setLandingFileId] = useState<string | null>(
        fileParam
    );
    const locateQuery = useQuery(
        trpc.files.locate.queryOptions(
            landingFileId ? { fileId: landingFileId } : skipToken,
            { staleTime: Infinity }
        )
    );
    const located = landingFileId ? locateQuery.data : undefined;
    const isLocating = !!landingFileId && locateQuery.isPending;
    const anchor = useMemo<(BatchAnchor & { key: string }) | null>(
        () =>
            located && landingFileId
                ? {
                      key: batchKeyOf(located.batchId),
                      fileId: landingFileId,
                      subpath: located.subpath,
                      pageStartId: located.pageStartId,
                  }
                : null,
        [located, landingFileId]
    );

    // Which batch the URL asks for: an explicit `?batch=`, else the one the
    // `?file=` being looked up sits in. Only while it's still the URL's: Back
    // to a `?batch=` page, or to the bare library, drops the landing's batch.
    // A key that no longer exists (deleted, or a stale link) asks for the
    // library.
    let targetKey = batchParam;
    if (targetKey === null && fileParam && fileParam === landingFileId) {
        targetKey = anchor?.key ?? null;
    }
    const targetQuery = useQuery(
        trpc.files.getBatch.queryOptions(
            targetKey !== null
                ? { batchId: batchIdOf(targetKey), search: searchInput }
                : skipToken,
            pollWhileBatchRestores
        )
    );
    const listedBatch = (key: string | null): BatchView | null =>
        key === null ? null : (batches.find((b) => b.key === key) ?? null);
    // Undefined while it's still being looked up.
    let resolvedTarget: string | null | undefined = null;
    if (isLocating) resolvedTarget = undefined;
    else if (targetKey !== null) {
        if (listedBatch(targetKey) || targetQuery.data) {
            resolvedTarget = targetKey;
        } else if (targetQuery.isPending) {
            resolvedTarget = undefined;
        }
    }

    const [view, setView] = useState<ViewState>({
        phase: 'library',
        key: null,
    });
    const [selection, setSelection] = useState<PaneSelection>(NO_SELECTION);
    const [viewMode, setViewMode] = useState(
        () => readRememberedViewMode() ?? initialViewMode
    );
    const changeViewMode = useStableCallback((mode: PaneViewMode) => {
        setViewMode(mode);
        rememberViewMode(mode);
    });
    // The toggle only shows from `sm` up, so below it the pane is a grid
    // whatever this browser remembers: a list chosen on a phone held sideways
    // would otherwise outlive turning it upright, with no control to undo it.
    const isViewModeToggleShown = useMediaQuery('(min-width: 40rem)', true);
    const paneViewMode = isViewModeToggleShown ? viewMode : 'grid';
    // The file viewer over the open batch. `?file=` drives it the way
    // `?batch=` drives the batch: a deep link from a retrieval-ready email
    // lands straight on the file.
    const [viewer, setViewer] = useState<{
        id: string;
        phase: ViewerPhase;
        /** Closed while still opening: close as soon as the open lands. */
        isCloseQueued?: boolean;
    } | null>(null);
    const [openedAspect, setOpenedAspect] = useState<{
        fileId: string;
        aspect: number;
    } | null>(null);
    // The `?file=` value we last wrote and are waiting for the router to
    // report back; undefined when the URL is settled.
    const [writtenFileParam, setWrittenFileParam] = useState<
        string | null | undefined
    >(undefined);
    // Shift-click anchor, tagged with its batch so a switch drops it.
    const lastToggled = useRef<{ key: string; fileId: string } | null>(null);

    function showBatch(next: ViewState) {
        setView(next);
        setSelection(NO_SELECTION);
    }

    // A selection is of what the pane shows: a new search changes that.
    const [selectionSearch, setSelectionSearch] = useState(activeSearch);
    if (selectionSearch !== activeSearch) {
        setSelectionSearch(activeSearch);
        setSelection(NO_SELECTION);
    }

    // Reconcile the URL into the view, during render (React's "adjust state
    // when a prop changes" pattern) so the first paint is already right.
    // Only from rest: mid-transition changes wait, and are picked up by the
    // render that settles the phase.
    const [hasInitialized, setHasInitialized] = useState(false);
    if (!hasInitialized) {
        if (!batchesQuery.isPending && resolvedTarget !== undefined) {
            setHasInitialized(true);
            // Landing on a batch (reload, deep link) skips the choreography.
            if (resolvedTarget)
                showBatch({ phase: 'split', key: resolvedTarget });
        }
    } else if (resolvedTarget !== undefined) {
        if (view.phase === 'library' && resolvedTarget) {
            showBatch({ phase: 'opening', key: resolvedTarget });
        } else if (view.phase === 'split' && !resolvedTarget) {
            setView({ phase: 'closing', key: view.key });
        } else if (
            view.phase === 'split' &&
            resolvedTarget &&
            resolvedTarget !== view.key
        ) {
            setView({
                ...view,
                phase: 'switching-out',
                nextKey: resolvedTarget,
            });
        }
    }

    // The open batch: its summary and folders. The library's own summary
    // stands in while it loads, and the last one shown stays up while a
    // batch that just went away closes. Never another search's: its folders
    // and match counts would page the new search's files wrongly.
    const viewBatchId = view.key === null ? undefined : batchIdOf(view.key);
    const openQuery = useQuery(
        trpc.files.getBatch.queryOptions(
            viewBatchId !== undefined
                ? { batchId: viewBatchId, search: searchInput }
                : skipToken,
            pollWhileBatchRestores
        )
    );
    const detail = openQuery.data ?? undefined;
    const freshBatch = useMemo(
        () =>
            detail
                ? toBatchView(detail)
                : (batches.find((b) => b.key === view.key) ?? null),
        [detail, batches, view.key]
    );
    const [shownBatch, setShownBatch] = useState<BatchView | null>(null);
    if (freshBatch && freshBatch !== shownBatch) setShownBatch(freshBatch);
    const openBatch =
        freshBatch ?? (shownBatch?.key === view.key ? shownBatch : null);

    const isSearchSubset = detail?.matchCount != null;
    const batchFiles = useBatchFiles({
        batch: detail,
        search: isSearchSubset ? searchInput : undefined,
        anchor: anchor?.key === view.key ? anchor : null,
    });

    // Same reconcile for the viewer: only over a batch at rest, and only for
    // a file the pane has loaded, so the photo has a tile to rise from and
    // return to. A `?file=` the pane hasn't loaded (Back to a file further
    // into the batch) is looked up like a deep link, and opens once its page
    // lands.
    //
    // In-app actions (a click, Esc, the arrows) drive the viewer directly and
    // write the URL alongside, because the router only reports a pushState
    // back ~250ms later and a history.back() ~180ms later: waiting for it put
    // that much dead time in front of every animation. Until the router
    // catches up, the URL is our own write, not news. Only a URL we didn't
    // write (Back/Forward, a deep link) is reconciled into the viewer.
    let viewerTarget: string | null = null;
    if (view.phase === 'split' && fileParam && batchFiles.locate(fileParam)) {
        viewerTarget = fileParam;
    }
    const isAwaitingUrl = writtenFileParam !== undefined;
    if (isAwaitingUrl && fileParam === writtenFileParam) {
        setWrittenFileParam(undefined);
    }
    if (viewer && view.phase !== 'split') {
        setViewer(null);
    } else if (view.phase === 'split' && openBatch && !isAwaitingUrl) {
        if (viewerTarget && !viewer) {
            setViewer({ id: viewerTarget, phase: 'opening' });
        } else if (viewer?.phase === 'open' && !viewerTarget) {
            setViewer({ ...viewer, phase: 'closing' });
        } else if (
            viewer?.phase === 'open' &&
            viewerTarget &&
            viewerTarget !== viewer.id
        ) {
            setViewer({ id: viewerTarget, phase: 'open' });
        } else if (
            fileParam &&
            !viewerTarget &&
            !viewer &&
            fileParam !== landingFileId &&
            batchFiles.sections.every((s) => !s.isLoading)
        ) {
            setLandingFileId(fileParam);
        }
    }

    const coverFiles = useMemo(() => {
        const files = batches.flatMap((b) => b.coverFiles);
        if (openBatch && !batches.some((b) => b.key === openBatch.key))
            files.push(...openBatch.coverFiles);
        return files;
    }, [batches, openBatch]);
    const pageChunks = useMemo(
        () => batchFiles.sections.flatMap((s) => s.pageFiles),
        [batchFiles.sections]
    );
    const coverUrls = useOrderedThumbnailUrls(coverFiles);
    const paneUrls = useThumbnailUrlsByPage(pageChunks);
    // A cover photo that lands on its own tile (phone) keeps its URL, so the
    // tile shows the image that was in flight instead of re-fetching it.
    const tileUrls = useMemo(
        () => ({ ...paneUrls, ...coverUrls }),
        [paneUrls, coverUrls]
    );

    /* ---- Transitions ---- */
    const stageRef = useRef<HTMLDivElement>(null);
    const libraryRef = useRef<HTMLDivElement>(null);
    const splitRef = useRef<HTMLDivElement>(null);
    const fxRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<BatchTransitions | null>(null);
    const libraryScrollTop = useRef(0);
    const hasPushedHistory = useRef(false);
    // The file whose tile takes focus once the viewer over it is gone.
    const focusOnViewerClose = useRef<string | null>(null);

    useLayoutEffect(() => {
        const { phase, key, nextKey } = view;
        if (phase === 'library' || phase === 'split' || !key) return;
        const library = libraryRef.current;
        const split = splitRef.current;
        const fx = fxRef.current;
        const stage = stageRef.current;
        // The batch vanished mid-flight (deleted elsewhere): settle without
        // the choreography.
        if (!library || !split || !fx || !stage) {
            const settled: ViewState =
                phase === 'closing'
                    ? { phase: 'library', key: null }
                    : { phase: 'split', key };
            void Promise.resolve().then(() => setView(settled));
            return;
        }
        const scroller = findScrollParent(stage);
        const engine = createBatchTransitions({
            library,
            split,
            fx,
            scroller,
        });
        engineRef.current = engine;

        if (phase === 'opening') {
            libraryScrollTop.current = scroller?.scrollTop ?? 0;
            void engine.open(key).then(() => {
                setView({ phase: 'split', key });
                split
                    .querySelector<HTMLElement>('[data-back]')
                    ?.focus({ preventScroll: true });
            });
        } else if (phase === 'closing') {
            void engine.close(key, libraryScrollTop.current).then(() => {
                setView({ phase: 'library', key: null });
                library
                    .querySelector<HTMLElement>(
                        `[data-fx-card="${CSS.escape(key)}"]`
                    )
                    ?.focus({ preventScroll: true });
            });
        } else if (phase === 'switching-out' && nextKey) {
            void engine
                .switchOut()
                .then(() => showBatch({ phase: 'switching-in', key: nextKey }));
        } else if (phase === 'switching-in') {
            void engine.switchIn().then(() => setView({ phase: 'split', key }));
        }
    }, [view]);

    useLayoutEffect(() => () => engineRef.current?.finish(), []);

    // `?batch=` changes go through the URL; the render-time reconcile above
    // turns them into transitions. Opening pushes a history entry so the
    // browser's back button closes the batch. Choosing a batch in the app
    // retires any deep link the page landed on.
    function navigate(key: string | null, mode: 'push' | 'replace') {
        setLandingFileId(null);
        const params = new URLSearchParams(window.location.search);
        if (key) params.set('batch', key);
        else params.delete('batch');
        params.delete('file');
        const query = params.toString();
        const url = query ? `?${query}` : window.location.pathname;
        if (mode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
    }
    // These only write the URL, so they're safe mid-transition: a click
    // during a choreography is honored once it settles, never dropped.
    function openFromLibrary(key: string) {
        if (targetKey) return;
        hasPushedHistory.current = true;
        navigate(key, 'push');
    }
    function backToLibrary() {
        if (!targetKey) return;
        if (hasPushedHistory.current) {
            hasPushedHistory.current = false;
            window.history.back();
        } else {
            navigate(null, 'replace');
        }
    }
    function selectFromList(key: string) {
        if (key === targetKey) return;
        navigate(key, 'replace');
    }

    // Opening a card fetches its batch and first page; hovering or focusing
    // it first starts that early, so the pane usually deals in loaded.
    function prefetchBatch(key: string) {
        const input = { batchId: batchIdOf(key), search: searchInput };
        queryClient
            .fetchQuery(trpc.files.getBatch.queryOptions(input))
            .then((batch) => {
                if (!batch) return;
                const subsetSearch =
                    batch.matchCount !== null ? searchInput : undefined;
                return queryClient.prefetchQuery(
                    trpc.files.listBatchFiles.queryOptions(
                        batchFilesInput(
                            batch,
                            firstFolderOf(batch),
                            subsetSearch
                        )
                    )
                );
            })
            .catch(() => {
                // A prefetch is a guess; the open fetches for real.
            });
    }

    // The viewer's URL keeps `?batch=` explicit, so closing a viewer that a
    // `?file=`-only deep link opened leaves the batch open behind it.
    const hasPushedViewerHistory = useRef(false);
    function navigateFile(fileId: string | null, mode: 'push' | 'replace') {
        const params = new URLSearchParams(window.location.search);
        if (view.key) params.set('batch', view.key);
        if (fileId) params.set('file', fileId);
        else params.delete('file');
        const url = `?${params.toString()}`;
        if (mode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
    }
    // Near the loaded edge of its section, the next page starts loading.
    function prefetchAround(fileId: string) {
        const found = batchFiles.locate(fileId);
        if (!found) return;
        const { section } = found;
        const at = section.files.findIndex((f) => f.id === fileId);
        if (section.hasNext && at >= section.files.length - PREFETCH_EDGE)
            batchFiles.loadNext(section.key);
        if (section.hasPrevious && at < PREFETCH_EDGE)
            batchFiles.loadPrevious(section.key);
    }
    function openFile(fileId: string, aspect: number | null) {
        if (viewer || view.phase !== 'split') return;
        setOpenedAspect(aspect ? { fileId, aspect } : null);
        setViewer({ id: fileId, phase: 'opening' });
        setWrittenFileParam(fileId);
        hasPushedViewerHistory.current = true;
        navigateFile(fileId, 'push');
        prefetchAround(fileId);
    }
    function closeFile() {
        if (!viewer || viewer.phase === 'closing' || !openBatch) return;
        if (viewer.isCloseQueued) return;
        // An Esc mid-open is honoured, not dropped: the open finishes its
        // flight (a reversed spring mid-air reads as a glitch) and closes.
        if (viewer.phase === 'opening')
            setViewer({ ...viewer, isCloseQueued: true });
        else setViewer({ ...viewer, phase: 'closing' });
        setWrittenFileParam(null);
        if (hasPushedViewerHistory.current) {
            hasPushedViewerHistory.current = false;
            window.history.back();
        } else {
            navigateFile(null, 'replace');
        }
    }
    function browseFile(fileId: string) {
        if (viewer?.phase !== 'open') return;
        setViewer({ id: fileId, phase: 'open' });
        setWrittenFileParam(fileId);
        navigateFile(fileId, 'replace');
        prefetchAround(fileId);
    }
    function placeOf(fileId: string): ViewerPlace | null {
        const found = batchFiles.locate(fileId);
        if (!found) return null;
        const { section, index } = found;
        return {
            index,
            total: section.total,
            folder: section.folder ? section.folder.subpath : undefined,
            isBeforeGap: section.hasNext && section.files.at(-1)?.id === fileId,
            isAfterGap: section.hasPrevious && section.files[0]?.id === fileId,
            isLoading: section.isLoading,
        };
    }
    // The viewer's step past a gap. A page that failed is asked for again:
    // the pane's retry is behind the viewer.
    function loadAround(fileId: string, direction: 'next' | 'previous') {
        const found = batchFiles.locate(fileId);
        if (!found) return;
        const { key, isError } = found.section;
        if (isError) batchFiles.retry(key);
        else if (direction === 'next') batchFiles.loadNext(key);
        else batchFiles.loadPrevious(key);
    }
    function findTileMedia(fileId: string): HTMLElement | null {
        return (
            splitRef.current?.querySelector<HTMLElement>(
                `[data-fx="tile"][data-file-id="${CSS.escape(fileId)}"] [data-fx="tile-media"]`
            ) ?? null
        );
    }
    function settleViewer() {
        if (!viewer) return;
        if (viewer.phase === 'opening') {
            const next = viewer.isCloseQueued ? 'closing' : 'open';
            setViewer({ id: viewer.id, phase: next });
            // A deep link opens the viewer without a click: start the next
            // page here too, so browsing on from its file never waits.
            if (next === 'open') prefetchAround(viewer.id);
            return;
        }
        focusOnViewerClose.current = viewer.id;
        setViewer(null);
    }
    // Back on the grid, keyboard focus returns to the photo's tile: once the
    // viewer is gone, and the page behind it no longer inert.
    useLayoutEffect(() => {
        const fileId = focusOnViewerClose.current;
        if (viewer || !fileId) return;
        focusOnViewerClose.current = null;
        splitRef.current
            ?.querySelector<HTMLElement>(
                `[data-fx="tile"][data-file-id="${CSS.escape(fileId)}"] [data-open-file]`
            )
            ?.focus({ preventScroll: true });
    }, [viewer]);

    /* ---- Selection ---- */
    // Clicking one file out of a whole-batch selection leaves the loaded
    // files picked, minus that one: the batch's unloaded rest can't be
    // picked one by one.
    function toggleFile(fileId: string, shiftKey: boolean) {
        if (!view.key) return;
        const loaded = batchFiles.files;
        const ids = loaded.map((f) => f.id);
        const last =
            lastToggled.current?.key === view.key
                ? lastToggled.current.fileId
                : null;
        setSelection((prev) => {
            const next = prev.isWholeBatch ? byId(loaded) : new Map(prev.files);
            const from = last ? ids.indexOf(last) : -1;
            const to = ids.indexOf(fileId);
            if (shiftKey && from >= 0 && to >= 0 && from !== to) {
                const [start, end] = [Math.min(from, to), Math.max(from, to)];
                loaded.slice(start, end + 1).forEach((f) => next.set(f.id, f));
            } else if (next.has(fileId)) {
                next.delete(fileId);
            } else if (to >= 0) {
                next.set(fileId, loaded[to]);
            }
            return { isWholeBatch: false, files: next };
        });
        lastToggled.current = { key: view.key, fileId };
    }
    // The whole batch, loaded or not, when every file shows; a search's
    // matches only as the loaded rows (the pane's label says which).
    function toggleAll() {
        if (!openBatch) return;
        if (openBatch.matchCount === null) {
            setSelection((prev) =>
                prev.isWholeBatch
                    ? NO_SELECTION
                    : { isWholeBatch: true, files: new Map() }
            );
            return;
        }
        const loaded = batchFiles.files;
        setSelection((prev) =>
            loaded.length > 0 && prev.files.size === loaded.length
                ? NO_SELECTION
                : { isWholeBatch: false, files: byId(loaded) }
        );
    }
    const viewerSelectedIds = useMemo(
        () =>
            new Set(
                selection.isWholeBatch
                    ? batchFiles.files.map((f) => f.id)
                    : selection.files.keys()
            ),
        [selection, batchFiles.files]
    );
    const selectedCount = selection.isWholeBatch
        ? (openBatch?.fileCount ?? 0)
        : selection.files.size;
    // Picked files as they load now, so the bar's actions see a restore
    // that's started since; one out of view (its folder collapsed) as it was.
    const selectedFiles = useMemo(() => {
        const loaded = byId(batchFiles.files);
        return [...selection.files.values()].map((f) => loaded.get(f.id) ?? f);
    }, [batchFiles.files, selection]);
    // A file deleted on its own, from its menu or the viewer, leaves the
    // selection, so the bulk delete after it doesn't send it again (#477).
    // A whole-batch selection goes by batch id and has no ids to drop.
    function dropFromSelection(fileId: string) {
        setSelection((prev) => {
            if (!prev.files.has(fileId)) return prev;
            const files = new Map(prev.files);
            files.delete(fileId);
            return { ...prev, files };
        });
    }

    /* ---- File actions ---- */
    const fileActions = useFileActions({ onDeleted: dropFromSelection });
    // The one confirm every tile's and row's menu shares (#477).
    const [fileConfirm, setFileConfirm] = useState<FileConfirm | null>(null);
    function runFileAction(action: FileAction, file: ActionableFile) {
        if (action === 'download') void fileActions.download(file);
        else setFileConfirm({ action, file, isOpen: true });
    }

    // Stable identities for the memoized pane and library, so opening,
    // browsing and closing the viewer don't re-render them.
    const onToggleFile = useStableCallback(toggleFile);
    const onToggleAll = useStableCallback(toggleAll);
    const onToggleFolder = useStableCallback(batchFiles.toggleFolder);
    const onLoadNext = useStableCallback(batchFiles.loadNext);
    const onLoadPrevious = useStableCallback(batchFiles.loadPrevious);
    const onRetrySection = useStableCallback(batchFiles.retry);
    const onOpenFile = useStableCallback(openFile);
    const onFileAction = useStableCallback(runFileAction);
    const onOpenBatch = useStableCallback(openFromLibrary);
    const onIntent = useStableCallback(prefetchBatch);
    const onBatchDeleted = useStableCallback(() => navigate(null, 'replace'));
    const showMoreBatches = useStableCallback(() => {
        void batchesQuery.fetchNextPage();
    });
    // The viewer calls this from the effect that started its animation, a
    // few renders ago; it must still see a close queued since then.
    const onViewerSettled = useStableCallback(settleViewer);

    if (!hasInitialized) {
        return (
            <div className="space-y-4">
                <LibraryHeading />
                <div className="flex flex-col items-center justify-center py-24">
                    <div className="relative">
                        <div className="size-12 rounded-xl bg-muted" />
                        <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">
                        Loading vault...
                    </p>
                </div>
            </div>
        );
    }

    if (libraryBatchCount === 0) {
        return (
            <div className="space-y-4">
                <LibraryHeading />
                <EmptyVault />
            </div>
        );
    }

    const isAtSplit =
        view.phase === 'split' ||
        view.phase === 'switching-out' ||
        view.phase === 'switching-in';
    const isSplitRendered = openBatch !== null && view.phase !== 'library';
    const hasSelection = selection.isWholeBatch || selection.files.size > 0;
    // The viewer is modal: the page behind it is out of reach of Tab and of
    // assistive tech while it's up.
    const isBehindViewer = viewer !== null;

    return (
        <div ref={stageRef} data-phase={view.phase} className="relative">
            <div
                ref={libraryRef}
                hidden={isAtSplit}
                inert={isBehindViewer}
                className={cn(
                    view.phase === 'closing' && 'absolute inset-x-0 top-0'
                )}
            >
                <LibraryView
                    batches={batches}
                    totalBatchCount={totalBatchCount}
                    libraryBatchCount={libraryBatchCount ?? totalBatchCount}
                    counts={counts}
                    thumbnailUrls={coverUrls}
                    search={search}
                    onSearchChange={setSearch}
                    activeSearch={activeSearch}
                    isSearching={isSearching}
                    onOpen={onOpenBatch}
                    onIntent={onIntent}
                    onShowMore={showMoreBatches}
                    isLoadingMore={batchesQuery.isFetchingNextPage}
                />
            </div>
            {isSplitRendered && (
                <div
                    ref={splitRef}
                    inert={isBehindViewer}
                    className={cn(
                        'z-1',
                        view.phase === 'opening'
                            ? 'absolute inset-x-0 top-0'
                            : 'relative'
                    )}
                >
                    <BatchSplitView
                        openBatch={openBatch}
                        batches={batches}
                        totalBatchCount={totalBatchCount}
                        thumbnailUrls={coverUrls}
                        search={search}
                        onSearchChange={setSearch}
                        onBack={backToLibrary}
                        onSelect={selectFromList}
                        onIntent={onIntent}
                        onShowMore={showMoreBatches}
                        isLoadingMore={batchesQuery.isFetchingNextPage}
                    >
                        <BatchPane
                            batch={openBatch}
                            sections={detail ? batchFiles.sections : null}
                            loadedCount={batchFiles.files.length}
                            thumbnailUrls={tileUrls}
                            selection={selection}
                            onToggleFile={onToggleFile}
                            onToggleAll={onToggleAll}
                            onToggleFolder={onToggleFolder}
                            onLoadNext={onLoadNext}
                            onLoadPrevious={onLoadPrevious}
                            onRetrySection={onRetrySection}
                            viewMode={paneViewMode}
                            onViewModeChange={changeViewMode}
                            onOpenFile={onOpenFile}
                            onFileAction={onFileAction}
                            onBatchDeleted={onBatchDeleted}
                        />
                    </BatchSplitView>
                </div>
            )}
            {viewer && openBatch && view.phase === 'split' && (
                <FileViewer
                    batchName={openBatch.name}
                    files={batchFiles.files}
                    fileId={viewer.id}
                    phase={viewer.phase}
                    placeOf={placeOf}
                    onLoadMore={loadAround}
                    urls={tileUrls}
                    initialAspect={openedAspect}
                    selectedIds={viewerSelectedIds}
                    selectedCount={selectedCount}
                    onToggleSelect={(fileId) => toggleFile(fileId, false)}
                    actions={fileActions}
                    onNavigate={browseFile}
                    onClose={closeFile}
                    onSettled={onViewerSettled}
                    findTileMedia={findTileMedia}
                />
            )}
            <div
                ref={fxRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10"
            />
            {hasSelection && isAtSplit && openBatch && (
                <div inert={isBehindViewer}>
                    <SelectionBar
                        batch={openBatch}
                        isWholeBatch={selection.isWholeBatch}
                        selectedFiles={selectedFiles}
                        onClear={() => setSelection(NO_SELECTION)}
                        onBatchDeleted={onBatchDeleted}
                    />
                </div>
            )}
            <FileConfirmDialogs
                confirm={fileConfirm}
                onOpenChange={(isOpen) =>
                    setFileConfirm((prev) => prev && { ...prev, isOpen })
                }
                actions={fileActions}
            />
        </div>
    );
}

function byId(files: LibraryFile[]): Map<string, LibraryFile> {
    return new Map(files.map((f) => [f.id, f]));
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
    }
    return null;
}

function EmptyVault() {
    return (
        <div className="flex flex-col items-center justify-center py-24">
            <div className="relative mb-6">
                <div className="flex size-20 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/50">
                    <Snowflake
                        className="size-8 text-muted-foreground/60"
                        strokeWidth={1.5}
                    />
                </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
                Your vault is empty
            </h2>
            <p className="mt-1.5 max-w-xs text-center text-sm text-muted-foreground">
                Upload files to archive them in deep cold storage. Retrieval
                takes up to 48 hours when you need them.
            </p>
            <Button
                nativeButton={false}
                render={<a href="/dashboard/upload" />}
                className="mt-6"
            >
                Upload files
            </Button>
        </div>
    );
}
