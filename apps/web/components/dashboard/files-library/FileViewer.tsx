'use client';

import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Download,
    Loader2,
    Maximize2,
    Play,
    RotateCw,
    Trash2,
    X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { isProbablyCold } from '@nexus/db/objectState';
import { Button } from '@/components/ui/button';
import { DeleteDialog } from '@/components/dashboard/DeleteDialog';
import {
    RetrieveDialog,
    getRetrievalEstimate,
} from '@/components/dashboard/RetrieveDialog';
import { useFileActions } from '@/components/dashboard/file-browser/FileActions';
import {
    deriveStatus,
    getFileExtension,
    getFileTypeInfo,
} from '@/components/dashboard/file-browser/status';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { formatCount, formatTimeLeft, type BatchSummary } from './batchSummary';
import {
    describeKind,
    findCompanions,
    getOriginalKind,
    type OriginalKind,
} from './fileDetails';
import {
    EASE,
    prefersReducedMotion,
    readSlowMotion,
    spring,
    type Rect,
} from './motion';
import { useOrderedThumbnailUrls } from './useOrderedThumbnailUrls';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

export type ViewerPhase = 'opening' | 'open' | 'closing';

interface FileViewerProps {
    batch: BatchSummary;
    fileId: string;
    phase: ViewerPhase;
    /** URLs the tiles already show (covers): the hero reuses the same image. */
    preferredUrls: Record<string, string>;
    /** Aspect ratio measured from the clicked tile's loaded thumbnail. */
    initialAspect: { fileId: string; aspect: number } | null;
    selectedIds: Set<string>;
    onToggleSelect: (fileId: string) => void;
    onNavigate: (fileId: string) => void;
    onClose: () => void;
    /** The opening or closing choreography has finished. */
    onSettled: () => void;
    findTileMedia: (fileId: string) => HTMLElement | null;
}

const PAGE = 100;
const SWIPE_PX = 60;

// Open/close timings in ms. The photo rides a stiff, nearly critically
// damped spring (~425ms open, ~400ms close to fully settle, visibly there
// well before); the backdrop, panel and controls finish inside that motion
// so nothing trails behind the photo.
const OPEN = {
    stiffness: 340,
    damping: 34,
    backdrop: 160,
    panel: 260,
    panelDelay: 40,
    chrome: 180,
    chromeDelay: 60,
    chromeStagger: 30,
    // Deep link, no tile on screen: a zoom in place instead of the flight.
    zoom: 220,
    fade: 140,
};
const CLOSE = {
    stiffness: 450,
    damping: 40,
    backdrop: 180,
    panel: 150,
    chrome: 100,
    fade: 120,
};

/**
 * A photo's details view: the thumbnail expanded out of its tile, prev/next
 * through the batch, a filmstrip, and a panel with what the file is, where
 * it sits (archived, restoring, ready) and the one action that moves it on.
 *
 * Selection lives here too, so a photographer can walk a shoot and pick the
 * frames worth restoring without leaving the viewer.
 */
export function FileViewer({
    batch,
    fileId,
    phase,
    preferredUrls,
    initialAspect,
    selectedIds,
    onToggleSelect,
    onNavigate,
    onClose,
    onSettled,
    findTileMedia,
}: FileViewerProps) {
    const files = batch.files;
    const index = files.findIndex((f) => f.id === fileId);
    const file = files[Math.max(0, index)];

    // Thumbnails for the 100-file pages around this one, chunked exactly like
    // the pane's (same page boundaries -> same query keys -> cache hits).
    const pageStart = Math.floor(Math.max(0, index) / PAGE) * PAGE;
    const windowFiles = useMemo(
        () => files.slice(Math.max(0, pageStart - PAGE), pageStart + 2 * PAGE),
        [files, pageStart]
    );
    const windowUrls = useOrderedThumbnailUrls(windowFiles);
    const urls = { ...windowUrls, ...preferredUrls };

    const rootRef = useRef<HTMLDivElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const ghostLayerRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    /* ---- Hero geometry: the image, contained in the stage ---- */
    const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
        w: 0,
        h: 0,
    });
    useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const measure = () =>
            setStageSize({ w: stage.clientWidth, h: stage.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(stage);
        return () => observer.disconnect();
    }, []);

    // Natural sizes of loaded previews, for files whose row predates the
    // stored thumbnail dimensions.
    const [loadedSizes, setLoadedSizes] = useState<
        Record<string, { w: number; h: number }>
    >({});
    const hasThumbnail = !!urls[file.id];
    const previewDims = storedPreviewDims(file) ?? loadedSizes[file.id];
    const aspect = resolveAspect(
        previewDims,
        initialAspect,
        file.id,
        hasThumbnail
    );
    const heroRect = fitRect(stageSize, aspect, !hasThumbnail);

    /* ---- Original bytes, for a file that's ready ---- */
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const [original, setOriginal] = useState<{
        id: string;
        url: string;
        kind: OriginalKind;
    } | null>(null);
    const [loadingOriginalId, setLoadingOriginalId] = useState<string | null>(
        null
    );
    const originalKind = getOriginalKind(file.name);
    const shownOriginal = original?.id === file.id ? original : null;
    async function showOriginal() {
        if (!originalKind) return;
        const id = file.id;
        setLoadingOriginalId(id);
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.files.getDownloadUrl.queryOptions({ fileId: id })
            );
            setOriginal({ id, url, kind: originalKind });
        } catch {
            toast.error('Could not load the original');
        } finally {
            setLoadingOriginalId(null);
        }
    }

    /* ---- Navigation ---- */
    const direction = useRef<1 | -1>(1);
    function goTo(nextIndex: number) {
        if (nextIndex < 0 || nextIndex >= files.length || nextIndex === index)
            return;
        direction.current = nextIndex > index ? 1 : -1;
        launchOutgoingGhost(direction.current);
        onNavigate(files[nextIndex].id);
    }

    // The outgoing photo slides off as a ghost; the incoming one (the real
    // hero, re-rendered with the new file) slides in from the other side.
    function launchOutgoingGhost(dir: 1 | -1) {
        const hero = heroRef.current;
        const layer = ghostLayerRef.current;
        if (!hero || !layer || prefersReducedMotion()) return;
        const r = hero.getBoundingClientRect();
        const g = hero.cloneNode(true) as HTMLElement;
        g.querySelectorAll('video').forEach((v) => v.remove());
        Object.assign(g.style, {
            position: 'fixed',
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
            margin: '0',
        });
        layer.append(g);
        const S = readSlowMotion();
        const a = g.animate(
            [
                { transform: 'none', opacity: 1 },
                { transform: `translateX(${-dir * 56}px)`, opacity: 0 },
            ],
            { duration: 200 * S, easing: EASE.accel, fill: 'forwards' }
        );
        void a.finished.then(
            () => g.remove(),
            () => g.remove()
        );
    }
    const previousFileId = useRef(fileId);
    useLayoutEffect(() => {
        if (previousFileId.current === fileId) return;
        previousFileId.current = fileId;
        const hero = heroRef.current;
        if (!hero || prefersReducedMotion()) return;
        const S = readSlowMotion();
        hero.animate(
            [
                {
                    transform: `translateX(${direction.current * 56}px)`,
                    opacity: 0,
                },
                { transform: 'none', opacity: 1 },
            ],
            {
                duration: 280 * S,
                delay: 40 * S,
                easing: EASE.decel,
                fill: 'backwards',
            }
        );
    }, [fileId]);

    // Preload the neighbours so browsing never waits on a thumbnail.
    const previousUrl = urlOf(files[index - 1]);
    const nextUrl = urlOf(files[index + 1]);
    function urlOf(neighbour: FileWithRetrieval | undefined) {
        return neighbour && urls[neighbour.id];
    }
    useEffect(() => {
        for (const url of [previousUrl, nextUrl]) {
            if (url) new Image().src = url;
        }
    }, [previousUrl, nextUrl]);

    /* ---- Open / close choreography ---- */
    useLayoutEffect(() => {
        if (phase !== 'opening') return;
        let isCancelled = false;
        void playOpen().then(() => {
            if (isCancelled) return;
            closeButtonRef.current?.focus({ preventScroll: true });
            onSettled();
        });
        return () => {
            isCancelled = true;
        };
        // Runs once per opening; the rest is read from refs at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    useLayoutEffect(() => {
        if (phase !== 'closing') return;
        let isCancelled = false;
        void playClose().then(() => {
            if (isCancelled) return;
            onSettled();
        });
        return () => {
            isCancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    async function playOpen() {
        const S = readSlowMotion();
        const hero = heroRef.current;
        const stage = stageRef.current;
        const tile = findTileMedia(fileId);
        const chrome = [
            ...(rootRef.current?.querySelectorAll<HTMLElement>(
                '[data-viewer-chrome]'
            ) ?? []),
        ];
        const anims: Animation[] = [];
        const fade = (el: HTMLElement | null, d: number, delay = 0) =>
            el &&
            anims.push(
                el.animate([{ opacity: 0 }, { opacity: 1 }], {
                    duration: d * S,
                    delay: delay * S,
                    easing: EASE.std,
                    fill: 'backwards',
                })
            );
        const src = tile?.getBoundingClientRect();
        if (
            !hero ||
            !stage ||
            !src ||
            !isOnScreen(src) ||
            prefersReducedMotion()
        ) {
            // No tile to rise from (deep link, scrolled away): zoom in place.
            fade(rootRef.current, OPEN.fade);
            if (hero && !prefersReducedMotion())
                anims.push(
                    hero.animate(
                        [{ transform: 'scale(.94)' }, { transform: 'none' }],
                        { duration: OPEN.zoom * S, easing: EASE.decel }
                    )
                );
            await settle(anims);
            return;
        }
        const hero_ = spring(OPEN.stiffness, OPEN.damping);
        const stageBox = stage.getBoundingClientRect();
        const from: Rect = {
            x: src.left - stageBox.left,
            y: src.top - stageBox.top,
            w: src.width,
            h: src.height,
        };
        // Measured now, not from render: on the first commit the stage size
        // state hasn't caught up yet.
        const target = fitRect(
            { w: stage.clientWidth, h: stage.clientHeight },
            aspect,
            !hasThumbnail
        );
        tile!.style.opacity = '0';
        fade(backdropRef.current, OPEN.backdrop);
        anims.push(
            hero.animate(
                [
                    {
                        ...boxFrame(from),
                        borderRadius: '8px',
                        boxShadow: '0 0 0 rgba(0,0,0,0)',
                    },
                    {
                        ...boxFrame(target),
                        borderRadius: '10px',
                        boxShadow: '0 30px 80px rgba(0,0,0,.5)',
                    },
                ],
                { duration: hero_.d * S, easing: hero_.e }
            )
        );
        const panel = panelRef.current;
        if (panel)
            anims.push(
                panel.animate(
                    [
                        { opacity: 0, transform: 'translateX(28px)' },
                        { opacity: 1, transform: 'none' },
                    ],
                    {
                        duration: OPEN.panel * S,
                        delay: OPEN.panelDelay * S,
                        easing: EASE.decel,
                        fill: 'backwards',
                    }
                )
            );
        chrome.forEach((el, i) =>
            fade(el, OPEN.chrome, OPEN.chromeDelay + i * OPEN.chromeStagger)
        );
        await settle(anims);
        tile!.style.removeProperty('opacity');
    }

    async function playClose() {
        const S = readSlowMotion();
        const hero = heroRef.current;
        const stage = stageRef.current;
        rootRef.current?.scrollTo({ top: 0 });
        const tile = findTileMedia(fileId);
        tile?.scrollIntoView({ block: 'nearest' });
        const dst = tile?.getBoundingClientRect();
        const anims: Animation[] = [];
        const out = (el: HTMLElement | null, d: number, extra: Keyframe = {}) =>
            el &&
            anims.push(
                el.animate([{ opacity: 1 }, { opacity: 0, ...extra }], {
                    duration: d * S,
                    easing: EASE.accel,
                    fill: 'forwards',
                })
            );
        if (
            !hero ||
            !stage ||
            !tile ||
            !dst ||
            !isOnScreen(dst) ||
            prefersReducedMotion()
        ) {
            out(rootRef.current, CLOSE.fade);
            await settle(anims);
            return;
        }
        const back = spring(CLOSE.stiffness, CLOSE.damping);
        const stageBox = stage.getBoundingClientRect();
        const heroBox = hero.getBoundingClientRect();
        const to: Rect = {
            x: dst.left - stageBox.left,
            y: dst.top - stageBox.top,
            w: dst.width,
            h: dst.height,
        };
        const from: Rect = {
            x: heroBox.left - stageBox.left,
            y: heroBox.top - stageBox.top,
            w: heroBox.width,
            h: heroBox.height,
        };
        tile.style.opacity = '0';
        hero.querySelectorAll('video').forEach((v) => v.pause());
        out(backdropRef.current, CLOSE.backdrop);
        out(panelRef.current, CLOSE.panel, { transform: 'translateX(28px)' });
        rootRef.current
            ?.querySelectorAll<HTMLElement>('[data-viewer-chrome]')
            .forEach((el) => out(el, CLOSE.chrome));
        anims.push(
            hero.animate(
                [
                    { ...boxFrame(from), borderRadius: '10px' },
                    { ...boxFrame(to), borderRadius: '8px' },
                ],
                { duration: back.d * S, easing: back.e, fill: 'forwards' }
            )
        );
        await settle(anims);
        tile.style.removeProperty('opacity');
        // Leave a trace of where the photo went home to.
        tile.animate(
            [
                { boxShadow: '0 0 0 2px rgba(96,165,250,.95)' },
                { boxShadow: '0 0 0 2px rgba(96,165,250,0)' },
            ],
            { duration: 1400, easing: EASE.std }
        );
    }

    /* ---- Keyboard and swipe ---- */
    const [isRetrieveOpen, setIsRetrieveOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const isDialogOpen = isRetrieveOpen || isDeleteOpen;
    useEffect(() => {
        if (phase === 'closing' || isDialogOpen) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest('input, textarea, [role="menu"]')) return;
            // Esc works from the first frame; browsing waits for the open.
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (phase !== 'open') return;
            if (e.key === 'ArrowRight') goTo(index + 1);
            else if (e.key === 'ArrowLeft') goTo(index - 1);
            else if (e.key === 's' || e.key === 'x') onToggleSelect(file.id);
            else return;
            e.preventDefault();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    // A click on the see-through page around the photo closes, like a click
    // outside a sheet. The photo, the details panel and every control stay
    // put. React bubbles clicks through portals, so a click inside one of
    // the viewer's own dialogs (DOM-outside the root) is ignored too.
    function closeOnBackdrop(e: ReactMouseEvent) {
        const target = e.target as HTMLElement;
        if (phase === 'closing' || !rootRef.current?.contains(target)) return;
        if (target.closest('button, a, input, [data-viewer-solid]')) return;
        onClose();
    }

    const swipeStart = useRef<{ x: number; y: number } | null>(null);
    function onPointerDown(e: ReactPointerEvent) {
        if (e.pointerType === 'mouse') return;
        swipeStart.current = { x: e.clientX, y: e.clientY };
    }
    function onPointerUp(e: ReactPointerEvent) {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dy) < SWIPE_PX)
            goTo(index + (dx < 0 ? 1 : -1));
    }

    /* ---- Actions ---- */
    const actions = useFileActions(file);
    function confirmDelete() {
        // Move on before the row disappears, so the viewer never points at
        // a file that's gone.
        const neighbour = files[index + 1] ?? files[index - 1];
        if (neighbour) {
            direction.current = files[index + 1] ? 1 : -1;
            onNavigate(neighbour.id);
        } else {
            onClose();
        }
        actions.onDelete();
    }

    if (index < 0) return null;
    const status = deriveStatus(file);
    const isSelected = selectedIds.has(file.id);

    return createPortal(
        <div
            ref={rootRef}
            role="dialog"
            aria-modal="true"
            aria-label={file.name}
            data-viewer-phase={phase}
            onClick={closeOnBackdrop}
            className={cn(
                'fixed inset-0 z-50 flex cursor-zoom-out flex-col overflow-y-auto lg:flex-row lg:overflow-hidden',
                phase === 'closing' && 'pointer-events-none'
            )}
        >
            <div
                ref={backdropRef}
                // See-through on purpose: the batch stays visible behind the
                // viewer, so it reads as a layer over the page, not a new one.
                className="fixed inset-0 bg-background/60 backdrop-blur-[2px]"
            />

            <div className="relative flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1">
                <header
                    data-viewer-chrome
                    // A scrim, not a bar: keeps the title legible over the
                    // see-through page without closing the view off.
                    className="flex h-14 shrink-0 items-center gap-3 bg-linear-to-b from-background/80 to-transparent px-3 sm:px-4"
                >
                    <Button
                        ref={closeButtonRef}
                        variant="ghost"
                        size="icon-sm"
                        onClick={onClose}
                        aria-label="Close viewer"
                    >
                        <X className="size-4" />
                    </Button>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                            {batch.name}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {formatCount(index + 1)} of{' '}
                            {formatCount(files.length)}
                        </p>
                    </div>
                    {selectedIds.size > 0 && (
                        <span className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/15 px-2.5 text-xs font-medium text-blue-600 tabular-nums dark:text-blue-300">
                            <Check className="size-3.5" />
                            {formatCount(selectedIds.size)} selected
                        </span>
                    )}
                </header>

                <div
                    ref={stageRef}
                    className="relative h-[58dvh] shrink-0 touch-pan-y lg:h-auto lg:min-h-0 lg:flex-1"
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                >
                    <div
                        ref={heroRef}
                        key={file.id}
                        data-viewer-solid
                        className="absolute cursor-default overflow-hidden rounded-[10px] bg-muted shadow-[0_30px_80px_rgba(0,0,0,.5)]"
                        style={{
                            left: heroRect.x,
                            top: heroRect.y,
                            width: heroRect.w,
                            height: heroRect.h,
                        }}
                    >
                        <HeroMedia
                            file={file}
                            thumbnailUrl={urls[file.id]}
                            original={shownOriginal}
                            onSize={(size) =>
                                setLoadedSizes((prev) =>
                                    prev[file.id]?.w === size.w
                                        ? prev
                                        : { ...prev, [file.id]: size }
                                )
                            }
                        />
                    </div>
                    {hasThumbnail && (
                        <span
                            data-viewer-chrome
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        >
                            {mediaLabel(!!shownOriginal, previewDims)}
                        </span>
                    )}
                    <NavButton
                        side="left"
                        disabled={index === 0}
                        onClick={() => goTo(index - 1)}
                    />
                    <NavButton
                        side="right"
                        disabled={index === files.length - 1}
                        onClick={() => goTo(index + 1)}
                    />
                </div>

                <Filmstrip
                    files={files}
                    index={index}
                    urls={urls}
                    selectedIds={selectedIds}
                    onPick={goTo}
                />
            </div>

            <aside
                ref={panelRef}
                aria-label="File details"
                data-viewer-solid
                className="relative w-full shrink-0 cursor-auto border-t bg-card/80 backdrop-blur-xl lg:w-85 lg:overflow-y-auto lg:border-t-0 lg:border-l"
            >
                <DetailsPanel
                    batch={batch}
                    file={file}
                    index={index}
                    status={status}
                    isSelected={isSelected}
                    originalKind={originalKind}
                    isShowingOriginal={!!shownOriginal}
                    isLoadingOriginal={loadingOriginalId === file.id}
                    onShowOriginal={showOriginal}
                    onToggleSelect={() => onToggleSelect(file.id)}
                    onRestore={() => setIsRetrieveOpen(true)}
                    onDownload={actions.onDownload}
                    onDelete={() => setIsDeleteOpen(true)}
                    onJumpTo={(id) => {
                        const target = files.findIndex((f) => f.id === id);
                        if (target >= 0) goTo(target);
                    }}
                    isRetrieving={actions.isRetrieving}
                />
            </aside>

            <div
                ref={ghostLayerRef}
                className="pointer-events-none fixed inset-0"
            />

            <RetrieveDialog
                open={isRetrieveOpen}
                onOpenChange={setIsRetrieveOpen}
                files={[file]}
                fileCount={1}
                onConfirm={actions.onRetrieval}
            />
            <DeleteDialog
                open={isDeleteOpen}
                onOpenChange={setIsDeleteOpen}
                fileCount={1}
                fileName={file.name}
                onConfirm={confirmDelete}
            />
        </div>,
        document.body
    );
}

/* ------------------------------------------------------------------ */

interface HeroMediaProps {
    file: FileWithRetrieval;
    thumbnailUrl: string | undefined;
    original: { url: string; kind: OriginalKind } | null;
    onSize: (size: { w: number; h: number }) => void;
}

function HeroMedia({ file, thumbnailUrl, original, onSize }: HeroMediaProps) {
    const [isOriginalLoaded, setIsOriginalLoaded] = useState(false);
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(file.name);
    if (original?.kind === 'video') {
        return (
            <video
                src={original.url}
                controls
                autoPlay
                playsInline
                className="absolute inset-0 size-full bg-black object-contain"
            />
        );
    }
    if (!thumbnailUrl) {
        return (
            <div
                className={cn(
                    'absolute inset-0 flex flex-col items-center justify-center gap-3',
                    colorClass
                )}
            >
                <TypeIcon className="size-14 opacity-70" strokeWidth={1.25} />
                <span className="text-sm font-semibold tracking-wide uppercase">
                    {getFileExtension(file.name) || 'file'}
                </span>
                <span className="text-xs text-muted-foreground">
                    No preview for this format
                </span>
            </div>
        );
    }
    return (
        <>
            {/* Presigned S3 URLs — see SelectableIcon for why not next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={thumbnailUrl}
                alt=""
                draggable={false}
                onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight)
                        onSize({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                className="absolute inset-0 size-full object-cover"
            />
            {original && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={original.url}
                    alt=""
                    draggable={false}
                    onLoad={() => setIsOriginalLoaded(true)}
                    className={cn(
                        'absolute inset-0 size-full object-cover transition-opacity duration-500',
                        isOriginalLoaded ? 'opacity-100' : 'opacity-0'
                    )}
                />
            )}
            {file.durationSeconds !== null && !original && (
                <span className="absolute inset-0 grid place-items-center">
                    <span className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs font-medium tabular-nums">
                        <Play className="size-3.5" />
                        {formatDuration(file.durationSeconds)}
                    </span>
                </span>
            )}
        </>
    );
}

function NavButton({
    side,
    disabled,
    onClick,
}: {
    side: keyof typeof NAV_SIDES;
    disabled: boolean;
    onClick: () => void;
}) {
    const { Icon, label, position } = NAV_SIDES[side];
    return (
        <button
            type="button"
            data-viewer-chrome
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={cn(
                'absolute top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border bg-background/70 text-foreground backdrop-blur-sm transition-[opacity,background-color] hover:bg-background disabled:opacity-0 sm:grid',
                position
            )}
        >
            <Icon className="size-5" />
        </button>
    );
}

const NAV_SIDES = {
    left: { Icon: ChevronLeft, label: 'Previous file', position: 'left-4' },
    right: { Icon: ChevronRight, label: 'Next file', position: 'right-4' },
};

interface FilmstripProps {
    files: FileWithRetrieval[];
    index: number;
    urls: Record<string, string>;
    selectedIds: Set<string>;
    onPick: (index: number) => void;
}

const STRIP_ITEM = 52;
const STRIP_GAP = 8;

function Filmstrip({
    files,
    index,
    urls,
    selectedIds,
    onPick,
}: FilmstripProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    // Virtualized: a single folder drop can be a ~9k-file batch (#402).
    const virtualizer = useVirtualizer({
        horizontal: true,
        count: files.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => STRIP_ITEM + STRIP_GAP,
        overscan: 10,
        paddingStart: 12,
        paddingEnd: 12,
        getItemKey: (i) => files[i].id,
    });
    const isFirstScroll = useRef(true);
    useEffect(() => {
        virtualizer.scrollToIndex(index, {
            align: 'center',
            behavior: isFirstScroll.current ? 'auto' : 'smooth',
        });
        isFirstScroll.current = false;
    }, [index, virtualizer]);

    return (
        <div
            ref={scrollRef}
            data-viewer-chrome
            className="relative h-19 shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        >
            <div
                className="relative h-full"
                style={{ width: virtualizer.getTotalSize() }}
            >
                {virtualizer.getVirtualItems().map((item) => {
                    const f = files[item.index];
                    const isCurrent = item.index === index;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => onPick(item.index)}
                            aria-label={f.name}
                            aria-current={isCurrent}
                            className={cn(
                                'absolute top-3 overflow-hidden rounded-md bg-muted transition-[opacity,box-shadow]',
                                isCurrent
                                    ? 'opacity-100 ring-2 ring-foreground'
                                    : 'opacity-55 hover:opacity-100'
                            )}
                            style={{
                                left: item.start,
                                width: STRIP_ITEM,
                                height: STRIP_ITEM,
                            }}
                        >
                            <StripThumb name={f.name} url={urls[f.id]} />
                            {selectedIds.has(f.id) && (
                                <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                                    <Check className="size-3" strokeWidth={3} />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function StripThumb({ name, url }: { name: string; url: string | undefined }) {
    if (url) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={url}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-full object-cover"
            />
        );
    }
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(name);
    return (
        <span className={cn('grid size-full place-items-center', colorClass)}>
            <TypeIcon className="size-4 opacity-70" />
        </span>
    );
}

interface DetailsPanelProps {
    batch: BatchSummary;
    file: FileWithRetrieval;
    index: number;
    status: ReturnType<typeof deriveStatus>;
    isSelected: boolean;
    originalKind: OriginalKind | null;
    isShowingOriginal: boolean;
    isLoadingOriginal: boolean;
    isRetrieving: boolean;
    onShowOriginal: () => void;
    onToggleSelect: () => void;
    onRestore: () => void;
    onDownload: () => void;
    onDelete: () => void;
    onJumpTo: (fileId: string) => void;
}

function DetailsPanel({
    batch,
    file,
    index,
    status,
    isSelected,
    originalKind,
    isShowingOriginal,
    isLoadingOriginal,
    isRetrieving,
    onShowOriginal,
    onToggleSelect,
    onRestore,
    onDownload,
    onDelete,
    onJumpTo,
}: DetailsPanelProps) {
    const companions = useMemo(
        () => findCompanions(batch.files, file),
        [batch.files, file]
    );
    const isCold = isProbablyCold(file);
    const ext = getFileExtension(file.name);
    const uploadedAt = new Date(file.createdAt);

    return (
        <div className="flex flex-col gap-5 p-5">
            <div>
                <h2 className="text-lg/snug font-semibold break-all">
                    {file.name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    {describeKind(file.name)} · {formatBytes(file.size)}
                </p>
            </div>

            <StatusCard
                file={file}
                status={status}
                isCold={isCold}
                originalKind={originalKind}
                isShowingOriginal={isShowingOriginal}
                isLoadingOriginal={isLoadingOriginal}
                isRetrieving={isRetrieving}
                onShowOriginal={onShowOriginal}
                onRestore={onRestore}
                onDownload={onDownload}
            />

            <div className="flex gap-2">
                <Button
                    variant={isSelected ? 'default' : 'outline'}
                    className="flex-1 justify-between"
                    onClick={onToggleSelect}
                    aria-pressed={isSelected}
                >
                    <span className="inline-flex items-center gap-2">
                        <Check className="size-4" />
                        {isSelected ? 'Selected' : 'Select'}
                    </span>
                    <kbd className="rounded-sm border border-current/25 px-1.5 font-mono text-[10px] opacity-70">
                        S
                    </kbd>
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={onDelete}
                    aria-label="Delete file"
                    className="text-destructive hover:text-destructive"
                >
                    <Trash2 className="size-4" />
                </Button>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 border-t pt-5 text-sm">
                <DetailRow label="Uploaded">
                    {formatDate(uploadedAt)},{' '}
                    {uploadedAt.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                    })}
                </DetailRow>
                <DetailRow label="Batch">
                    <span className="wrap-break-word">{batch.name}</span>
                </DetailRow>
                <DetailRow label="Position">
                    {formatCount(index + 1)} of{' '}
                    {formatCount(batch.files.length)}
                </DetailRow>
                <DetailRow label="Size">
                    <span title={`${formatCount(file.size)} bytes`}>
                        {formatBytes(file.size)}
                    </span>
                </DetailRow>
                <DetailRow label="Type">
                    {describeKind(file.name)}
                    {ext && (
                        <span className="text-muted-foreground"> · .{ext}</span>
                    )}
                </DetailRow>
                {file.durationSeconds !== null && (
                    <DetailRow label="Duration">
                        {formatDuration(file.durationSeconds)}
                    </DetailRow>
                )}
                {file.thumbnailWidth && file.thumbnailHeight && (
                    <DetailRow label="Preview">
                        {file.thumbnailWidth} × {file.thumbnailHeight} px
                    </DetailRow>
                )}
                <DetailRow label="Storage">
                    {isCold ? 'Deep Archive' : 'Warm'}
                    <span className="text-muted-foreground"> · estimated</span>
                </DetailRow>
            </dl>

            {companions.length > 0 && (
                <div className="border-t pt-5">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Same shot, other formats
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {companions.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => onJumpTo(c.id)}
                                className="inline-flex h-8 items-center gap-2 rounded-lg border bg-foreground/4 px-2.5 text-xs font-medium transition-colors hover:bg-foreground/8"
                            >
                                <span className="uppercase">
                                    {getFileExtension(c.name)}
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                    {formatBytes(c.size)}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <p className="hidden border-t pt-4 text-xs text-muted-foreground lg:block">
                <Kbd>←</Kbd> <Kbd>→</Kbd> browse · <Kbd>S</Kbd> select ·{' '}
                <Kbd>Esc</Kbd> close
            </p>
        </div>
    );
}

interface StatusCardProps {
    file: FileWithRetrieval;
    status: ReturnType<typeof deriveStatus>;
    isCold: boolean;
    originalKind: OriginalKind | null;
    isShowingOriginal: boolean;
    isLoadingOriginal: boolean;
    isRetrieving: boolean;
    onShowOriginal: () => void;
    onRestore: () => void;
    onDownload: () => void;
}

// One card per state, each ending in the action that moves the file on:
// archived -> restore, restoring -> wait, ready -> download.
function StatusCard({
    file,
    status,
    isCold,
    originalKind,
    isShowingOriginal,
    isLoadingOriginal,
    isRetrieving,
    onShowOriginal,
    onRestore,
    onDownload,
}: StatusCardProps) {
    if (status === 'available') {
        return (
            <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/6 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    Ready to download
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {readyWindowCopy(file.activeRetrieval?.expiresAt ?? null)}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                    <Button onClick={onDownload} className="w-full">
                        <Download className="size-4" />
                        Download original
                    </Button>
                    {originalKind && !isShowingOriginal && (
                        <ShowOriginalButton
                            kind={originalKind}
                            isLoading={isLoadingOriginal}
                            onClick={onShowOriginal}
                        />
                    )}
                </div>
            </section>
        );
    }
    if (status === 'retrieving') {
        return (
            <section className="rounded-xl border border-blue-500/30 bg-blue-500/6 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300">
                    <RotateCw className="size-3.5 animate-spin animation-duration-[3s]" />
                    Restoring from the archive
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    Ready within 48 hours. We&rsquo;ll email you when it can be
                    downloaded.
                </p>
            </section>
        );
    }
    const estimate = getRetrievalEstimate([file]);
    return (
        <section className="rounded-xl border bg-foreground/3 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-muted-foreground/60" />
                Archived
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
                {isCold
                    ? 'In deep archive. You’re seeing a preview; restore it to download the original.'
                    : 'Probably still in warm storage, so a restore is usually quick.'}
            </p>
            <Button
                onClick={onRestore}
                disabled={isRetrieving}
                className="mt-3 w-full justify-between"
            >
                <span className="inline-flex items-center gap-2">
                    {isRetrieving ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <RotateCw className="size-4" />
                    )}
                    Restore this file
                </span>
                <span className="text-xs font-normal opacity-80">
                    {estimate.label.replace('Ready in ', '')}
                </span>
            </Button>
        </section>
    );
}

const ORIGINAL_ACTIONS: Record<
    OriginalKind,
    { Icon: typeof Play; label: string }
> = {
    image: { Icon: Maximize2, label: 'View full resolution' },
    video: { Icon: Play, label: 'Play original' },
};

function ShowOriginalButton({
    kind,
    isLoading,
    onClick,
}: {
    kind: OriginalKind;
    isLoading: boolean;
    onClick: () => void;
}) {
    const { Icon, label } = ORIGINAL_ACTIONS[kind];
    return (
        <Button
            variant="outline"
            onClick={onClick}
            disabled={isLoading}
            className="w-full"
        >
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {!isLoading && <Icon className="size-4" />}
            {label}
        </Button>
    );
}

function DetailRow({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right tabular-nums">{children}</dd>
        </>
    );
}

function Kbd({ children }: { children: ReactNode }) {
    return (
        <kbd className="rounded-sm border border-border bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
            {children}
        </kbd>
    );
}

/* ------------------------------------------------------------------ */

// Wide enough at the sides for the prev/next buttons to sit beside the
// photo, not on it; the bottom keeps room for the preview label.
const STAGE_PADS = {
    desktop: { x: 72, top: 24, bottom: 48 },
    phone: { x: 12, top: 12, bottom: 12 },
};
const NO_PREVIEW_MAX = { w: 360, h: 270 };

function fitRect(
    stage: { w: number; h: number },
    aspect: number,
    isIconCard: boolean
): Rect {
    const pad = stage.w < 640 ? STAGE_PADS.phone : STAGE_PADS.desktop;
    const areaH = Math.max(0, stage.h - pad.top - pad.bottom);
    let availW = Math.max(0, stage.w - pad.x * 2);
    let availH = areaH;
    if (isIconCard) {
        availW = Math.min(availW, NO_PREVIEW_MAX.w);
        availH = Math.min(availH, NO_PREVIEW_MAX.h);
    }
    let w = availW;
    let h = w / aspect;
    if (h > availH) {
        h = availH;
        w = h * aspect;
    }
    // Centred in the padded area: the label space sits under the photo.
    return { x: (stage.w - w) / 2, y: pad.top + (areaH - h) / 2, w, h };
}

function storedPreviewDims(
    file: FileWithRetrieval
): { w: number; h: number } | undefined {
    if (!file.thumbnailWidth || !file.thumbnailHeight) return undefined;
    return { w: file.thumbnailWidth, h: file.thumbnailHeight };
}

// Best known shape of the photo, most to least reliable: its preview's real
// dimensions, the clicked tile's loaded thumbnail, then a guess.
function resolveAspect(
    previewDims: { w: number; h: number } | undefined,
    initialAspect: { fileId: string; aspect: number } | null,
    fileId: string,
    hasThumbnail: boolean
): number {
    if (previewDims) return previewDims.w / previewDims.h;
    if (initialAspect?.fileId === fileId) return initialAspect.aspect;
    if (hasThumbnail) return 1;
    return 4 / 3;
}

function mediaLabel(
    isOriginal: boolean,
    previewDims: { w: number; h: number } | undefined
): string {
    if (isOriginal) return 'Original';
    if (!previewDims) return 'Preview';
    return `Preview · ${Math.max(previewDims.w, previewDims.h)} px`;
}

function readyWindowCopy(expiresAt: Date | null): string {
    if (!expiresAt) return 'Restored and downloadable.';
    const timeLeft = formatTimeLeft(new Date(expiresAt));
    const until = [`Until ${formatDate(expiresAt)}`, timeLeft]
        .filter(Boolean)
        .join(' · ');
    return `${until}. After that it goes back to the archive.`;
}

function boxFrame(r: Rect): Keyframe {
    return {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.w}px`,
        height: `${r.h}px`,
    };
}

function isOnScreen(r: DOMRect): boolean {
    return (
        r.width > 0 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth
    );
}

async function settle(anims: Animation[]) {
    await Promise.all(anims.map((a) => a.finished.catch(() => undefined)));
}
