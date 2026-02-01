'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border">
                <Input
                    placeholder="Search procedures..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2">
                    {Object.entries(grouped).map(([group, procs]) => (
                        <div key={group} className="mb-4">
                            {group !== '_root' && (
                                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {group}
                                </div>
                            )}
                            <div className="space-y-0.5">
                                {procs.map((proc) => {
                                    const displayPath =
                                        group !== '_root'
                                            ? proc.path.slice(group.length + 1)
                                            : proc.path;

                                    return (
                                        <button
                                            key={proc.path}
                                            onClick={() => onSelect(proc.path)}
                                            className={cn(
                                                'w-full flex items-center gap-2 px-2 min-h-11 rounded-md text-sm text-left transition-colors',
                                                selectedPath === proc.path
                                                    ? 'bg-accent text-accent-foreground'
                                                    : 'text-foreground hover:bg-accent/50'
                                            )}
                                        >
                                            <Badge
                                                variant={proc.type}
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
                        </div>
                    ))}

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
