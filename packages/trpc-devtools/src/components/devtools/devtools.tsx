'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { HistoryItem } from '@/lib/storage';
import type { TRPCResponse } from '@/lib/request';
import type { ProcedureSchema, RouterSchema } from '@/server/types';
import * as React from 'react';
import { ProcedureList, ProcedureListSkeleton } from './procedure-list';
import { ProcedureView, ProcedureViewSkeleton } from './procedure-view';
import { RequestHistoryPanel } from './request-history';

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

    const handleHistoryReplay = React.useCallback((item: HistoryItem) => {
        setSelectedPath(item.request.path);
        setHistoryReplay({
            input:
                item.request.input !== undefined
                    ? JSON.stringify(item.request.input, null, 2)
                    : '',
            response: item.response,
        });
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

    const selectedProcedure = React.useMemo<ProcedureSchema | null>(() => {
        if (!schema || !selectedPath) return null;
        return schema.procedures.find((p) => p.path === selectedPath) ?? null;
    }, [schema, selectedPath]);

    if (error) {
        return (
            <div
                className={cn(
                    'trpc-devtools flex items-center justify-center h-screen bg-background',
                    className
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
                    'trpc-devtools flex h-screen bg-background text-foreground',
                    className
                )}
            >
                {/* Sidebar skeleton */}
                <div className="w-64 border-r border-border flex flex-col">
                    <div className="p-4 border-b border-border">
                        <h1 className="text-lg font-semibold">tRPC Devtools</h1>
                        <Skeleton className="h-3 w-20 mt-1" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <ProcedureListSkeleton />
                    </div>
                </div>

                {/* Main content skeleton */}
                <div className="flex-1 overflow-hidden">
                    <ProcedureViewSkeleton />
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'trpc-devtools flex h-screen bg-background text-foreground',
                className
            )}
        >
            {/* Sidebar */}
            <div className="w-64 border-r border-border flex flex-col">
                <div className="p-4 border-b border-border">
                    <h1 className="text-lg font-semibold">tRPC Devtools</h1>
                    <p className="text-xs text-muted-foreground">
                        {schema.procedures.length} procedures
                    </p>
                </div>
                <div className="flex-1 overflow-hidden">
                    <ProcedureList
                        procedures={schema.procedures}
                        selectedPath={selectedPath}
                        onSelect={setSelectedPath}
                    />
                </div>
                <RequestHistoryPanel onReplay={handleHistoryReplay} />
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
                {selectedProcedure ? (
                    <ProcedureView
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
        </div>
    );
}
