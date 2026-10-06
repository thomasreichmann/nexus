'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Snowflake } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { deriveStatus } from '@/components/dashboard/file-browser/status';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useTRPC } from '@/lib/trpc/client';
import { getLivePollOptionsWhile } from '@/lib/trpc/polling';
import { BatchPane, type PaneViewMode } from './BatchPane';
import { BatchSplitView } from './BatchSplitView';
import { FileViewer, type ViewerPhase } from './FileViewer';
import { LibraryHeading, LibraryView } from './LibraryView';
import { SelectionBar } from './SelectionBar';
import { summarizeBatches, type BatchSummary } from './batchSummary';
import {
    createBatchTransitions,
    type BatchTransitions,
} from './batchTransition';
import { useOrderedThumbnailUrls } from './useOrderedThumbnailUrls';
import { useStableCallback } from './useStableCallback';

const SEARCH_DEBOUNCE_MS = 300;
const NO_COUNTS = { archived: 0, retrieving: 0, available: 0 };
const BATCH_PAGE = 12;
const FILE_PAGE = 100;

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

/**
 * Prototype of the #455 file browser: a library of batch cards that opens
 * into a batch list + batch pane, with the motion study's choreography
 * between them. The URL is the source of truth for which batch is open —
 * `?batch=<key>`, or `?file=<id>` from a retrieval-ready email — so the
 * browser's back button closes a batch like "All batches" does.
 */
export function FilesLibrary() {
    const trpc = useTRPC();
    const searchParams = useSearchParams();

    const { data: countsData } = useQuery(
        trpc.files.statusCounts.queryOptions(
            undefined,
            getLivePollOptionsWhile((counts) => (counts?.retrieving ?? 0) > 0)
        )
    );
    const counts = countsData ?? NO_COUNTS;

    const { data: groupsData, isLoading } = useQuery(
        trpc.files.listGrouped.queryOptions(
            {},
            getLivePollOptionsWhile((groups) =>
                (groups ?? []).some((group) =>
                    group.files.some(
                        (file) => deriveStatus(file) === 'retrieving'
                    )
                )
            )
        )
    );
    const groups = useMemo(() => groupsData ?? [], [groupsData]);

    const [search, setSearch] = useState('');
    const activeSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
    const batches = useMemo(
        () => summarizeBatches(groups, activeSearch),
        [groups, activeSearch]
    );
    const allBatches = useMemo(
        () => (activeSearch ? summarizeBatches(groups, '') : batches),
        [groups, activeSearch, batches]
    );
    const [batchLimit, setBatchLimit] = useState(BATCH_PAGE);
    const visibleBatches = useMemo(
        () => batches.slice(0, batchLimit),
        [batches, batchLimit]
    );

    // Which batch the URL asks for: an explicit `?batch=`, else the batch
    // holding a deep-linked `?file=`. A key that no longer exists (deleted,
    // or a stale link) asks for the library.
    const fileParam = searchParams.get('file');
    const targetKey = useMemo(() => {
        const key = searchParams.get('batch');
        if (key) return allBatches.some((b) => b.key === key) ? key : null;
        if (fileParam)
            return (
                allBatches.find((b) => b.files.some((f) => f.id === fileParam))
                    ?.key ?? null
            );
        return null;
    }, [searchParams, fileParam, allBatches]);

    const [view, setView] = useState<ViewState>({
        phase: 'library',
        key: null,
    });
    const [fileLimit, setFileLimit] = useState(FILE_PAGE);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(
        () => new Set()
    );
    const [viewMode, setViewMode] = useState<PaneViewMode>('grid');
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
    const lastToggled = useRef<{ key: string; index: number } | null>(null);

    function showBatch(next: ViewState, limit = FILE_PAGE) {
        setView(next);
        setFileLimit(limit);
        setSelectedIds(new Set());
    }

    // Reconcile the URL into the view, during render (React's "adjust state
    // when a prop changes" pattern) so the first paint is already right.
    // Only from rest: mid-transition changes wait, and are picked up by the
    // render that settles the phase.
    const [hasInitialized, setHasInitialized] = useState(false);
    if (!isLoading && !hasInitialized) {
        setHasInitialized(true);
        if (targetKey) {
            // Landing on a batch (reload, deep link) skips the choreography,
            // and opens far enough into the batch to show the linked file.
            const batch = allBatches.find((b) => b.key === targetKey);
            const index =
                batch?.files.findIndex((f) => f.id === fileParam) ?? -1;
            showBatch(
                { phase: 'split', key: targetKey },
                Math.ceil((index + 1) / FILE_PAGE) * FILE_PAGE || FILE_PAGE
            );
        }
    } else if (hasInitialized) {
        if (view.phase === 'library' && targetKey) {
            showBatch({ phase: 'opening', key: targetKey });
        } else if (view.phase === 'split' && !targetKey) {
            setView({ phase: 'closing', key: view.key });
        } else if (
            view.phase === 'split' &&
            targetKey &&
            targetKey !== view.key
        ) {
            setView({ ...view, phase: 'switching-out', nextKey: targetKey });
        }
    }

    // The search-filtered summary when the batch matches, else the full one:
    // a search that excludes the open batch shouldn't empty its pane.
    const openBatch =
        batches.find((b) => b.key === view.key) ??
        allBatches.find((b) => b.key === view.key) ??
        null;

    // Same reconcile for the viewer: only over a batch at rest, only for a
    // file that batch shows, and with the file's tile rendered so the photo
    // has somewhere to rise from and return to.
    //
    // In-app actions (a click, Esc, the arrows) drive the viewer directly and
    // write the URL alongside, because the router only reports a pushState
    // back ~250ms later and a history.back() ~180ms later: waiting for it put
    // that much dead time in front of every animation. Until the router
    // catches up, the URL is our own write, not news. Only a URL we didn't
    // write (Back/Forward, a deep link) is reconciled into the viewer.
    let viewerTarget: string | null = null;
    if (
        view.phase === 'split' &&
        openBatch?.files.some((f) => f.id === fileParam)
    ) {
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
            revealFile(openBatch, viewerTarget);
            setViewer({ id: viewerTarget, phase: 'opening' });
        } else if (viewer?.phase === 'open' && !viewerTarget) {
            revealFile(openBatch, viewer.id);
            setViewer({ ...viewer, phase: 'closing' });
        } else if (
            viewer?.phase === 'open' &&
            viewerTarget &&
            viewerTarget !== viewer.id
        ) {
            setViewer({ id: viewerTarget, phase: 'open' });
        }
    }
    function revealFile(batch: BatchSummary, fileId: string) {
        const index = batch.files.findIndex((f) => f.id === fileId);
        if (index >= fileLimit)
            setFileLimit(Math.ceil((index + 1) / FILE_PAGE) * FILE_PAGE);
    }

    const coverFiles = useMemo(() => {
        const files = visibleBatches.flatMap((b) => b.coverFiles);
        if (openBatch && !visibleBatches.includes(openBatch))
            files.push(...openBatch.coverFiles);
        return files;
    }, [visibleBatches, openBatch]);
    const paneFiles = useMemo(
        () => openBatch?.files.slice(0, fileLimit) ?? [],
        [openBatch, fileLimit]
    );
    const coverUrls = useOrderedThumbnailUrls(coverFiles);
    const paneUrls = useOrderedThumbnailUrls(paneFiles);
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
    const pushedHistory = useRef(false);

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
    // browser's back button closes the batch.
    function navigate(key: string | null, mode: 'push' | 'replace') {
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
        pushedHistory.current = true;
        navigate(key, 'push');
    }
    function backToLibrary() {
        if (!targetKey) return;
        if (pushedHistory.current) {
            pushedHistory.current = false;
            window.history.back();
        } else {
            navigate(null, 'replace');
        }
    }
    function selectFromList(key: string) {
        if (key === targetKey) return;
        navigate(key, 'replace');
    }

    // The viewer's URL keeps `?batch=` explicit, so closing a viewer that a
    // `?file=`-only deep link opened leaves the batch open behind it.
    const pushedViewerHistory = useRef(false);
    function navigateFile(fileId: string | null, mode: 'push' | 'replace') {
        const params = new URLSearchParams(window.location.search);
        if (view.key) params.set('batch', view.key);
        if (fileId) params.set('file', fileId);
        else params.delete('file');
        const url = `?${params.toString()}`;
        if (mode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
    }
    function openFile(fileId: string, aspect: number | null) {
        if (viewer || view.phase !== 'split') return;
        setOpenedAspect(aspect ? { fileId, aspect } : null);
        setViewer({ id: fileId, phase: 'opening' });
        setWrittenFileParam(fileId);
        pushedViewerHistory.current = true;
        navigateFile(fileId, 'push');
    }
    function closeFile() {
        if (!viewer || viewer.phase === 'closing' || !openBatch) return;
        if (viewer.isCloseQueued) return;
        revealFile(openBatch, viewer.id);
        // An Esc mid-open is honoured, not dropped: the open finishes its
        // flight (a reversed spring mid-air reads as a glitch) and closes.
        if (viewer.phase === 'opening')
            setViewer({ ...viewer, isCloseQueued: true });
        else setViewer({ ...viewer, phase: 'closing' });
        setWrittenFileParam(null);
        if (pushedViewerHistory.current) {
            pushedViewerHistory.current = false;
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
            return;
        }
        // Back on the grid, keyboard focus returns to the photo's tile.
        findTileMedia(viewer.id)
            ?.closest('[data-fx="tile"]')
            ?.querySelector<HTMLElement>('[data-open-file]')
            ?.focus({ preventScroll: true });
        setViewer(null);
    }

    /* ---- Selection ---- */
    function toggleFile(index: number, shiftKey: boolean) {
        if (!view.key) return;
        const last =
            lastToggled.current?.key === view.key
                ? lastToggled.current.index
                : null;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (shiftKey && last !== null && last !== index) {
                const [start, end] = [
                    Math.min(last, index),
                    Math.max(last, index),
                ];
                paneFiles.slice(start, end + 1).forEach((f) => next.add(f.id));
                return next;
            }
            const id = paneFiles[index].id;
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        lastToggled.current = { key: view.key, index };
    }
    function toggleFileById(fileId: string) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(fileId)) next.delete(fileId);
            else next.add(fileId);
            return next;
        });
    }
    function toggleAll() {
        if (!openBatch) return;
        setSelectedIds((prev) =>
            prev.size === openBatch.files.length
                ? new Set()
                : new Set(openBatch.files.map((f) => f.id))
        );
    }
    const selectedFiles =
        openBatch?.files.filter((f) => selectedIds.has(f.id)) ?? [];

    // Stable identities for the memoized pane and library, so opening,
    // browsing and closing the viewer don't re-render them.
    const onToggleFile = useStableCallback(toggleFile);
    const onToggleAll = useStableCallback(toggleAll);
    const onOpenFile = useStableCallback(openFile);
    const onOpenBatch = useStableCallback(openFromLibrary);
    const onBatchDeleted = useStableCallback(() => navigate(null, 'replace'));
    const showMoreBatches = useStableCallback(() =>
        setBatchLimit((n) => n + BATCH_PAGE)
    );
    const showMoreFiles = useStableCallback(() =>
        setFileLimit((n) => n + FILE_PAGE)
    );
    // The viewer calls this from the effect that started its animation, a
    // few renders ago; it must still see a close queued since then.
    const onViewerSettled = useStableCallback(settleViewer);

    if (isLoading) {
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

    if (groups.length === 0) {
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

    return (
        <div ref={stageRef} data-phase={view.phase} className="relative">
            <div
                ref={libraryRef}
                hidden={isAtSplit}
                className={cn(
                    view.phase === 'closing' && 'absolute inset-x-0 top-0'
                )}
            >
                <LibraryView
                    batches={visibleBatches}
                    totalBatchCount={batches.length}
                    libraryBatchCount={allBatches.length}
                    counts={counts}
                    thumbnailUrls={coverUrls}
                    search={search}
                    onSearchChange={setSearch}
                    activeSearch={activeSearch}
                    onOpen={onOpenBatch}
                    onShowMore={showMoreBatches}
                />
            </div>
            {isSplitRendered && (
                <div
                    ref={splitRef}
                    className={cn(
                        'z-1',
                        view.phase === 'opening'
                            ? 'absolute inset-x-0 top-0'
                            : 'relative'
                    )}
                >
                    <BatchSplitView
                        openBatch={openBatch}
                        batches={visibleBatches}
                        totalBatchCount={batches.length}
                        thumbnailUrls={coverUrls}
                        search={search}
                        onSearchChange={setSearch}
                        onBack={backToLibrary}
                        onSelect={selectFromList}
                        onShowMore={showMoreBatches}
                    >
                        <BatchPane
                            batch={openBatch}
                            thumbnailUrls={tileUrls}
                            fileLimit={fileLimit}
                            onShowMoreFiles={showMoreFiles}
                            selectedIds={selectedIds}
                            onToggleFile={onToggleFile}
                            onToggleAll={onToggleAll}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                            onOpenFile={onOpenFile}
                            onBatchDeleted={onBatchDeleted}
                        />
                    </BatchSplitView>
                </div>
            )}
            {viewer && openBatch && view.phase === 'split' && (
                <FileViewer
                    batch={openBatch}
                    fileId={viewer.id}
                    phase={viewer.phase}
                    preferredUrls={coverUrls}
                    initialAspect={openedAspect}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleFileById}
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
            {selectedFiles.length > 0 && isAtSplit && (
                <SelectionBar
                    selectedFiles={selectedFiles}
                    onClear={() => setSelectedIds(new Set())}
                />
            )}
        </div>
    );
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
