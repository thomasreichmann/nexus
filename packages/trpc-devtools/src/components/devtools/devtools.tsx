'use client';

import * as React from 'react';
import {
    Eraser,
    FileJson,
    Keyboard,
    Menu,
    SunMoon,
    Terminal,
} from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { formatShortcut, useIsApplePlatform } from '@/lib/platform';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useTheme, type ThemeMode } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import type { HistoryItem } from '@/lib/storage';
import type { TRPCResponse } from '@/lib/request';
import type { ProcedureSchema, RouterSchema } from '@/server/types';
import { CommandPalette, type PaletteAction } from './command-palette';
import { ProcedureList, ProcedureListSkeleton } from './procedure-list';
import {
    ProcedureView,
    ProcedureViewSkeleton,
    type ProcedureViewHandle,
} from './procedure-view';
import { RequestHistoryPanel } from './request-history';
import { ShortcutsHelp } from './shortcuts-help';
import { ThemeToggle } from './theme-toggle';

export interface TRPCDevtoolsProps {
    /** URL to fetch the schema from */
    schemaUrl: string;
    /** URL of the tRPC endpoint */
    trpcUrl: string;
    /** Custom headers to send with requests */
    headers?: Record<string, string>;
    /** Additional className for the container */
    className?: string;
}

export function TRPCDevtools({
    schemaUrl,
    trpcUrl,
    headers,
    className,
}: TRPCDevtoolsProps) {
    const [schema, setSchema] = React.useState<RouterSchema | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
    const [historyReplay, setHistoryReplay] = React.useState<{
        input: string;
        response: TRPCResponse | null;
    } | null>(null);

    const isMobile = useIsMobile();
    const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

    const { mode, resolvedTheme, cycleMode, isTransitioning } = useTheme();
    const isApple = useIsApplePlatform();

    const [isPaletteOpen, setIsPaletteOpen] = React.useState(false);
    const [isHelpOpen, setIsHelpOpen] = React.useState(false);
    const procedureViewRef = React.useRef<ProcedureViewHandle>(null);

    const closeDrawer = React.useCallback(() => setIsDrawerOpen(false), []);
    const closePalette = React.useCallback(() => setIsPaletteOpen(false), []);
    const closeHelp = React.useCallback(() => setIsHelpOpen(false), []);

    const openPalette = React.useCallback(() => {
        setIsHelpOpen(false);
        setIsDrawerOpen(false);
        setIsPaletteOpen(true);
    }, []);

    // Reset drawer state when the viewport expands past the mobile breakpoint
    React.useEffect(() => {
        if (!isMobile) setIsDrawerOpen(false);
    }, [isMobile]);

    // Selecting a procedure closes the drawer and reveals the procedure view
    const handleSelect = React.useCallback((path: string) => {
        setSelectedPath(path);
        setIsDrawerOpen(false);
    }, []);

    const handleHistoryReplay = React.useCallback((item: HistoryItem) => {
        setSelectedPath(item.request.path);
        setHistoryReplay({
            input:
                item.request.input !== undefined
                    ? JSON.stringify(item.request.input, null, 2)
                    : '',
            response: item.response,
        });
        setIsDrawerOpen(false);
    }, []);

    // Fetch schema on mount
    React.useEffect(() => {
        async function fetchSchema() {
            try {
                const res = await fetch(schemaUrl);
                if (!res.ok) {
                    throw new Error(`Failed to fetch schema: ${res.status}`);
                }
                const data = await res.json();
                setSchema(data);

                // Auto-select first procedure
                if (data.procedures.length > 0 && !selectedPath) {
                    setSelectedPath(data.procedures[0].path);
                }
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : 'Failed to load schema'
                );
            }
        }

        fetchSchema();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount, not when selectedPath changes
    }, [schemaUrl]);

    // Cycle to the previous/next procedure in schema order (wraps around)
    const selectByOffset = React.useCallback(
        (offset: number) => {
            if (!schema || schema.procedures.length === 0) return;

            const procedures = schema.procedures;
            const currentIndex = procedures.findIndex(
                (p) => p.path === selectedPath
            );
            const nextIndex =
                currentIndex === -1
                    ? 0
                    : (currentIndex + offset + procedures.length) %
                      procedures.length;
            setSelectedPath(procedures[nextIndex].path);
        },
        [schema, selectedPath]
    );

    // Global keyboard shortcuts. Skips events a more specific handler
    // already claimed (e.defaultPrevented), e.g. Cmd+Enter inside the JSON
    // editor, so nothing fires twice.
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

            const key = e.key.toLowerCase();
            const isModalOpen = isPaletteOpen || isHelpOpen;

            if (key === 'k' && !e.shiftKey) {
                e.preventDefault();
                if (isPaletteOpen) {
                    setIsPaletteOpen(false);
                } else {
                    openPalette();
                }
                return;
            }

            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                setIsPaletteOpen(false);
                setIsHelpOpen((prev) => !prev);
                return;
            }

            // The rest act on the studio behind a modal — ignore while one is open
            if (isModalOpen) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                procedureViewRef.current?.execute();
            } else if (key === 'l' && e.shiftKey) {
                e.preventDefault();
                procedureViewRef.current?.clearResponse();
            } else if (e.key === '[') {
                e.preventDefault();
                selectByOffset(-1);
            } else if (e.key === ']') {
                e.preventDefault();
                selectByOffset(1);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isPaletteOpen, isHelpOpen, openPalette, selectByOffset]);

    const paletteActions = React.useMemo<PaletteAction[]>(
        () => [
            {
                id: 'clear-response',
                label: 'Clear response',
                icon: Eraser,
                shortcut: formatShortcut('L', { isApple, isShift: true }),
                run: () => procedureViewRef.current?.clearResponse(),
            },
            {
                id: 'toggle-theme',
                label: 'Toggle theme',
                icon: SunMoon,
                run: cycleMode,
            },
            {
                id: 'copy-curl',
                label: 'Copy as cURL',
                icon: Terminal,
                run: () => procedureViewRef.current?.copyCurl(),
            },
            {
                id: 'toggle-raw',
                label: 'Toggle raw/parsed response',
                icon: FileJson,
                run: () => procedureViewRef.current?.toggleRaw(),
            },
            {
                id: 'keyboard-shortcuts',
                label: 'Keyboard shortcuts',
                icon: Keyboard,
                shortcut: formatShortcut('?', { isApple }),
                run: () => setIsHelpOpen(true),
            },
        ],
        [isApple, cycleMode]
    );

    const selectedProcedure = React.useMemo<ProcedureSchema | null>(() => {
        if (!schema || !selectedPath) return null;
        return schema.procedures.find((p) => p.path === selectedPath) ?? null;
    }, [schema, selectedPath]);

    const rootClassName = cn(
        'trpc-devtools',
        resolvedTheme,
        isTransitioning && 'theme-transition',
        className
    );

    if (error) {
        return (
            <div
                className={cn(
                    rootClassName,
                    'flex items-center justify-center h-dvh bg-background'
                )}
            >
                <div className="text-center space-y-2">
                    <p className="text-destructive font-semibold">
                        Error loading schema
                    </p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                </div>
            </div>
        );
    }

    if (!schema) {
        return (
            <div
                className={cn(
                    rootClassName,
                    'flex flex-col md:flex-row h-dvh bg-background text-foreground'
                )}
            >
                {isMobile ? (
                    <MobileHeader />
                ) : (
                    <div className="w-64 border-r border-border flex flex-col">
                        <div className="p-4 border-b border-border">
                            <h1 className="text-lg font-semibold">
                                tRPC Devtools
                            </h1>
                            <Skeleton className="h-3 w-20 mt-1" />
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <ProcedureListSkeleton />
                        </div>
                    </div>
                )}

                {/* Main content skeleton */}
                <div className="flex-1 overflow-hidden">
                    <ProcedureViewSkeleton />
                </div>
            </div>
        );
    }

    const sidebarContent = (
        <SidebarContent
            schema={schema}
            selectedPath={selectedPath}
            onSelect={handleSelect}
            onReplay={handleHistoryReplay}
            onOpenPalette={openPalette}
            paletteShortcut={formatShortcut('K', { isApple })}
            themeMode={mode}
            onCycleTheme={cycleMode}
        />
    );

    return (
        <div
            className={cn(
                rootClassName,
                'flex flex-col md:flex-row h-dvh bg-background text-foreground'
            )}
        >
            {isMobile ? (
                <>
                    <MobileHeader onOpenMenu={() => setIsDrawerOpen(true)} />
                    <Drawer
                        isOpen={isDrawerOpen}
                        onClose={closeDrawer}
                        label="Procedure navigation"
                    >
                        {sidebarContent}
                    </Drawer>
                </>
            ) : (
                <div className="w-64 border-r border-border flex flex-col">
                    {sidebarContent}
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
                {selectedProcedure ? (
                    <ProcedureView
                        ref={procedureViewRef}
                        procedure={selectedProcedure}
                        trpcUrl={trpcUrl}
                        headers={headers}
                        historyReplay={historyReplay}
                        onHistoryConsumed={() => setHistoryReplay(null)}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        Select a procedure to get started
                    </div>
                )}
            </div>

            <CommandPalette
                isOpen={isPaletteOpen}
                onClose={closePalette}
                procedures={schema.procedures}
                actions={paletteActions}
                onSelectProcedure={handleSelect}
            />
            <ShortcutsHelp isOpen={isHelpOpen} onClose={closeHelp} />
        </div>
    );
}

interface MobileHeaderProps {
    onOpenMenu?: () => void;
}

function MobileHeader({ onOpenMenu }: MobileHeaderProps) {
    return (
        <header className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
            <button
                type="button"
                aria-label="Open navigation menu"
                onClick={onOpenMenu}
                disabled={!onOpenMenu}
                className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-md transition-colors',
                    'hover:bg-accent/50 disabled:opacity-50',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                )}
            >
                <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-base font-semibold">tRPC Devtools</h1>
        </header>
    );
}

interface SidebarContentProps {
    schema: RouterSchema;
    selectedPath: string | null;
    onSelect: (path: string) => void;
    onReplay: (item: HistoryItem) => void;
    onOpenPalette: () => void;
    /** Preformatted palette shortcut hint, e.g. "⌘K" */
    paletteShortcut: string;
    themeMode: ThemeMode;
    onCycleTheme: () => void;
}

function SidebarContent({
    schema,
    selectedPath,
    onSelect,
    onReplay,
    onOpenPalette,
    paletteShortcut,
    themeMode,
    onCycleTheme,
}: SidebarContentProps) {
    return (
        <>
            <div className="p-4 border-b border-border flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h1 className="text-lg font-semibold">tRPC Devtools</h1>
                    <p className="text-xs text-muted-foreground">
                        {schema.procedures.length} procedures
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={onOpenPalette}
                        title={`Command palette (${paletteShortcut})`}
                        aria-label={`Open command palette (${paletteShortcut})`}
                        className={cn(
                            'flex h-9 items-center rounded-md px-1.5 transition-colors',
                            'hover:bg-accent/50',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                        )}
                    >
                        <Kbd>{paletteShortcut}</Kbd>
                    </button>
                    <ThemeToggle mode={themeMode} onCycle={onCycleTheme} />
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <ProcedureList
                    procedures={schema.procedures}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                />
            </div>
            <RequestHistoryPanel onReplay={onReplay} />
        </>
    );
}
