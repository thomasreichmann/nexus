'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ProcedureList, ProcedureListSkeleton } from './procedure-list';
import { ProcedureView, ProcedureViewSkeleton } from './procedure-view';
import type { RouterSchema, ProcedureSchema } from '@/server/types';

export interface TRPCStudioProps {
    /** URL to fetch the schema from */
    schemaUrl: string;
    /** URL of the tRPC endpoint */
    trpcUrl: string;
    /** Custom headers to send with requests */
    headers?: Record<string, string>;
    /** Additional className for the container */
    className?: string;
}

export function TRPCStudio({
    schemaUrl,
    trpcUrl,
    headers,
    className,
}: TRPCStudioProps) {
    const [schema, setSchema] = React.useState<RouterSchema | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

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
                    'trpc-studio flex items-center justify-center h-screen bg-background',
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
                    'trpc-studio flex h-screen bg-background text-foreground',
                    className
                )}
            >
                {/* Sidebar skeleton */}
                <div className="w-64 border-r border-border flex flex-col">
                    <div className="p-4 border-b border-border">
                        <h1 className="text-lg font-semibold">tRPC Studio</h1>
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
                'trpc-studio flex h-screen bg-background text-foreground',
                className
            )}
        >
            {/* Sidebar */}
            <div className="w-64 border-r border-border flex flex-col">
                <div className="p-4 border-b border-border">
                    <h1 className="text-lg font-semibold">tRPC Studio</h1>
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
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
                {selectedProcedure ? (
                    <ProcedureView
                        procedure={selectedProcedure}
                        trpcUrl={trpcUrl}
                        headers={headers}
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
