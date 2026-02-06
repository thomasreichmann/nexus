'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { loadCollapsedGroups, saveCollapsedGroups } from '@/lib/storage';
import { cn } from '@/lib/utils';
import type { ProcedureSchema } from '@/server/types';

interface ProcedureListProps {
    procedures: ProcedureSchema[];
    selectedPath: string | null;
    onSelect: (path: string) => void;
}

export function ProcedureList({
    procedures,
    selectedPath,
    onSelect,
}: ProcedureListProps) {
    const [search, setSearch] = React.useState('');
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
        () => new Set(loadCollapsedGroups())
    );
    const [focusedIndex, setFocusedIndex] = React.useState<number>(-1);

    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const listContainerRef = React.useRef<HTMLDivElement>(null);

    // Group procedures by their first path segment (router name)
    const grouped = React.useMemo(() => {
        const filtered = procedures.filter((p) =>
            p.path.toLowerCase().includes(search.toLowerCase())
        );

        const groups: Record<string, ProcedureSchema[]> = {};

        for (const proc of filtered) {
            const parts = proc.path.split('.');
            const group = parts.length > 1 ? parts[0] : '_root';

            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(proc);
        }

        return groups;
    }, [procedures, search]);

    // Build flat list of focusable items and index map for O(1) lookups
    const { focusableItems, focusIndexMap } = React.useMemo(() => {
        const items: Array<
            | { type: 'group'; name: string }
            | { type: 'procedure'; path: string }
        > = [];
        const indexMap = new Map<string, number>();

        for (const [group, procs] of Object.entries(grouped)) {
            if (group !== '_root') {
                indexMap.set(`group-${group}`, items.length);
                items.push({ type: 'group', name: group });
            }

            if (!collapsedGroups.has(group)) {
                for (const proc of procs) {
                    indexMap.set(proc.path, items.length);
                    items.push({ type: 'procedure', path: proc.path });
                }
            }
        }

        return { focusableItems: items, focusIndexMap: indexMap };
    }, [grouped, collapsedGroups]);

    // Persist collapsed state
    React.useEffect(() => {
        saveCollapsedGroups(Array.from(collapsedGroups));
    }, [collapsedGroups]);

    const toggleGroup = React.useCallback((group: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });
    }, []);

    // Generate stable ID for an item
    const getItemId = React.useCallback(
        (
            item:
                | { type: 'group'; name: string }
                | { type: 'procedure'; path: string }
        ) => {
            return item.type === 'group'
                ? `proc-group-${item.name}`
                : `proc-item-${item.path.replace(/\./g, '-')}`;
        },
        []
    );

    // Focus management using DOM IDs for reliability
    const focusItem = React.useCallback(
        (index: number) => {
            if (index < 0 || index >= focusableItems.length) return;

            setFocusedIndex(index);
            const item = focusableItems[index];
            const element = document.getElementById(getItemId(item));
            (element as HTMLButtonElement | null)?.focus();
        },
        [focusableItems, getItemId]
    );

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            // Ignore if typing in search (except Escape)
            if (
                document.activeElement === searchInputRef.current &&
                e.key !== 'Escape'
            ) {
                return;
            }

            switch (e.key) {
                case 'ArrowDown': {
                    e.preventDefault();
                    const nextIndex =
                        focusedIndex < focusableItems.length - 1
                            ? focusedIndex + 1
                            : 0;
                    focusItem(nextIndex);
                    break;
                }
                case 'ArrowUp': {
                    e.preventDefault();
                    const prevIndex =
                        focusedIndex > 0
                            ? focusedIndex - 1
                            : focusableItems.length - 1;
                    focusItem(prevIndex);
                    break;
                }
                case 'Enter': {
                    if (
                        focusedIndex >= 0 &&
                        focusedIndex < focusableItems.length
                    ) {
                        const item = focusableItems[focusedIndex];
                        if (item.type === 'group') {
                            toggleGroup(item.name);
                        } else {
                            onSelect(item.path);
                        }
                    }
                    break;
                }
                case 'Escape': {
                    if (document.activeElement === searchInputRef.current) {
                        searchInputRef.current?.blur();
                        // Focus first item after blur
                        if (focusableItems.length > 0) {
                            focusItem(0);
                        }
                    }
                    break;
                }
            }
        },
        [focusedIndex, focusableItems, focusItem, toggleGroup, onSelect]
    );

    // Global "/" shortcut to focus search
    React.useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // "/" focuses search (ignore if in text input)
            if (
                e.key === '/' &&
                document.activeElement?.tagName !== 'INPUT' &&
                document.activeElement?.tagName !== 'TEXTAREA'
            ) {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
        };

        document.addEventListener('keydown', handleGlobalKeyDown);
        return () =>
            document.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    return (
        <div
            className="flex flex-col h-full"
            onKeyDown={handleKeyDown}
            ref={listContainerRef}
        >
            <div className="p-3 border-b border-border">
                <Input
                    ref={searchInputRef}
                    placeholder="Search procedures... (press /)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2" role="tree" aria-label="Procedure list">
                    {Object.entries(grouped).map(([group, procs]) => {
                        const isCollapsed = collapsedGroups.has(group);
                        const groupButtonId = `proc-group-${group}`;
                        const contentId = `group-content-${group}`;
                        const focusIndex =
                            focusIndexMap.get(`group-${group}`) ?? -1;

                        return (
                            <div
                                key={group}
                                className="mb-2"
                                role="group"
                                aria-labelledby={
                                    group !== '_root'
                                        ? groupButtonId
                                        : undefined
                                }
                            >
                                {group !== '_root' && (
                                    <button
                                        id={groupButtonId}
                                        onClick={() => toggleGroup(group)}
                                        onFocus={() =>
                                            setFocusedIndex(focusIndex)
                                        }
                                        aria-expanded={!isCollapsed}
                                        aria-controls={contentId}
                                        className={cn(
                                            'w-full flex items-center gap-1 px-2 py-1.5 min-h-11 rounded-md text-xs font-semibold text-muted-foreground uppercase tracking-wider transition-colors',
                                            'hover:bg-accent/50',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                                        )}
                                    >
                                        <ChevronRight
                                            className={cn(
                                                'h-4 w-4 transition-transform duration-150',
                                                !isCollapsed && 'rotate-90'
                                            )}
                                        />
                                        <span>{group}</span>
                                        <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70">
                                            ({procs.length})
                                        </span>
                                    </button>
                                )}
                                <AnimatePresence initial={false}>
                                    {!isCollapsed && (
                                        <motion.div
                                            id={contentId}
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{
                                                height: 'auto',
                                                opacity: 1,
                                            }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{
                                                duration: 0.15,
                                                ease: 'easeOut',
                                            }}
                                            className="overflow-hidden"
                                        >
                                            <div className="space-y-0.5">
                                                {procs.map((proc) => {
                                                    const displayPath =
                                                        group !== '_root'
                                                            ? proc.path.slice(
                                                                  group.length +
                                                                      1
                                                              )
                                                            : proc.path;
                                                    const itemFocusIndex =
                                                        focusIndexMap.get(
                                                            proc.path
                                                        ) ?? -1;

                                                    return (
                                                        <button
                                                            ref={(el) =>
                                                                setItemRef(
                                                                    proc.path,
                                                                    el
                                                                )
                                                            }
                                                            key={proc.path}
                                                            role="treeitem"
                                                            aria-selected={
                                                                selectedPath ===
                                                                proc.path
                                                            }
                                                            onClick={() =>
                                                                onSelect(
                                                                    proc.path
                                                                )
                                                            }
                                                            onFocus={() =>
                                                                setFocusedIndex(
                                                                    itemFocusIndex
                                                                )
                                                            }
                                                            className={cn(
                                                                'w-full flex items-center gap-2 px-2 min-h-11 rounded-md text-sm text-left transition-colors',
                                                                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                                                selectedPath ===
                                                                    proc.path
                                                                    ? 'bg-accent text-accent-foreground'
                                                                    : 'text-foreground hover:bg-accent/50'
                                                            )}
                                                        >
                                                            <Badge
                                                                variant={
                                                                    proc.type
                                                                }
                                                                className="text-[10px] px-1.5 py-0"
                                                            >
                                                                {proc.type
                                                                    .slice(0, 1)
                                                                    .toUpperCase()}
                                                            </Badge>
                                                            <span className="font-mono text-xs truncate">
                                                                {displayPath}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}

                    {Object.keys(grouped).length === 0 && (
                        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                            No procedures found
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}

export function ProcedureListSkeleton() {
    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border">
                <Skeleton className="h-11 w-full" />
            </div>
            <div className="p-2 space-y-4">
                {/* First group */}
                <div>
                    <Skeleton className="h-3 w-16 mb-2 ml-2" />
                    <div className="space-y-0.5">
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="flex items-center gap-2 px-2 min-h-11"
                            >
                                <Skeleton className="h-4 w-5 rounded" />
                                <Skeleton className="h-3 flex-1" />
                            </div>
                        ))}
                    </div>
                </div>
                {/* Second group */}
                <div>
                    <Skeleton className="h-3 w-20 mb-2 ml-2" />
                    <div className="space-y-0.5">
                        {[1, 2].map((i) => (
                            <div
                                key={i}
                                className="flex items-center gap-2 px-2 min-h-11"
                            >
                                <Skeleton className="h-4 w-5 rounded" />
                                <Skeleton className="h-3 flex-1" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
