'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResizablePanels } from '@/components/ui/resizable-panels';
import { Skeleton } from '@/components/ui/skeleton';
import { SchemaForm } from './schema-form';
import { ResponseViewer } from './response-viewer';
import { executeRequest, type TRPCResponse } from '@/lib/request';
import { parseZodError } from '@/lib/zod-error';
import {
    saveToHistory,
    loadSuperJSONPreference,
    saveSuperJSONPreference,
} from '@/lib/storage';
import type { ProcedureSchema } from '@/server/types';

interface ProcedureViewProps {
    procedure: ProcedureSchema;
    trpcUrl: string;
    headers?: Record<string, string>;
}

export function ProcedureView({
    procedure,
    trpcUrl,
    headers,
}: ProcedureViewProps) {
    const [input, setInput] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const [response, setResponse] = React.useState<TRPCResponse | null>(null);

    // Track SuperJSON preference - load from storage on mount
    const [useSuperJSON, setUseSuperJSON] = React.useState<boolean>(() => {
        // Default to stored preference, or false if unknown
        return loadSuperJSONPreference(trpcUrl) ?? false;
    });

    // Reset state when procedure changes
    React.useEffect(() => {
        setInput('');
        setResponse(null);
    }, [procedure.path]);

    const validationErrors = response?.error
        ? parseZodError(response.error)
        : null;

    const handleSubmit = async () => {
        if (procedure.type === 'subscription') {
            // Subscriptions not supported in MVP
            return;
        }

        setIsLoading(true);

        try {
            let parsedInput: unknown = undefined;

            if (input.trim()) {
                try {
                    parsedInput = JSON.parse(input);
                } catch {
                    setResponse({
                        ok: false,
                        error: { message: 'Invalid JSON input' },
                        rawResponse: null,
                        usedSuperJSON: false,
                        timing: {
                            startedAt: Date.now(),
                            completedAt: Date.now(),
                            durationMs: 0,
                        },
                    });
                    return;
                }
            }

            let result = await executeRequest(
                {
                    path: procedure.path,
                    type: procedure.type,
                    input: parsedInput,
                },
                {
                    trpcUrl,
                    headers,
                    useSuperJSON,
                }
            );

            // Auto-detect SuperJSON: if request failed and we weren't using SuperJSON,
            // check if error looks like a SuperJSON parsing issue and retry
            if (
                !result.ok &&
                !useSuperJSON &&
                looksLikeSuperJSONError(result.error?.message)
            ) {
                result = await executeRequest(
                    {
                        path: procedure.path,
                        type: procedure.type,
                        input: parsedInput,
                    },
                    {
                        trpcUrl,
                        headers,
                        useSuperJSON: true,
                    }
                );

                // If retry succeeded or gave a different error, update preference
                if (
                    result.ok ||
                    !looksLikeSuperJSONError(result.error?.message)
                ) {
                    setUseSuperJSON(true);
                    saveSuperJSONPreference(trpcUrl, true);
                }
            }

            setResponse(result);

            // Update SuperJSON preference if response indicates it's being used
            if (result.usedSuperJSON !== useSuperJSON) {
                setUseSuperJSON(result.usedSuperJSON);
                saveSuperJSONPreference(trpcUrl, result.usedSuperJSON);
            }

            // Save to history
            saveToHistory(
                {
                    path: procedure.path,
                    type: procedure.type,
                    input: parsedInput,
                },
                result
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <motion.div
            key={procedure.path}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="flex flex-col h-full gap-4 p-4"
        >
            {/* Procedure header */}
            <div className="flex items-center gap-3">
                <Badge variant={procedure.type} className="text-xs">
                    {procedure.type.toUpperCase()}
                </Badge>
                <code className="font-mono text-lg font-semibold">
                    {procedure.path}
                </code>
            </div>

            {/* Optional metadata - animate as single container */}
            {(procedure.description ||
                (procedure.tags && procedure.tags.length > 0)) && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.2, ease: 'easeOut', delay: 0.1 }}
                    className="space-y-2 overflow-hidden"
                >
                    {procedure.description && (
                        <p className="text-sm text-muted-foreground">
                            {procedure.description}
                        </p>
                    )}
                    {procedure.tags && procedure.tags.length > 0 && (
                        <div className="flex gap-1">
                            {procedure.tags.map((tag) => (
                                <Badge
                                    key={tag}
                                    variant="outline"
                                    className="text-xs"
                                >
                                    {tag}
                                </Badge>
                            ))}
                        </div>
                    )}
                </motion.div>
            )}

            {/* Main content - resizable panels */}
            <ResizablePanels
                className="flex-1"
                first={
                    <Card className="flex flex-col overflow-hidden h-full">
                        <CardHeader className="py-3 px-4 border-b border-border">
                            <CardTitle className="text-sm font-medium">
                                Request
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 p-4 overflow-auto">
                            <SchemaForm
                                schema={procedure.inputSchema}
                                value={input}
                                onChange={setInput}
                                onSubmit={handleSubmit}
                                isLoading={isLoading}
                                procedureType={procedure.type}
                                validationErrors={validationErrors}
                            />
                        </CardContent>
                    </Card>
                }
                second={
                    <Card className="flex flex-col overflow-hidden h-full">
                        <CardHeader className="py-3 px-4 border-b border-border">
                            <CardTitle className="text-sm font-medium">
                                Response
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 overflow-hidden">
                            <ResponseViewer
                                response={response}
                                zodIssues={validationErrors}
                            />
                        </CardContent>
                    </Card>
                }
            />
        </motion.div>
    );
}

export function ProcedureViewSkeleton() {
    return (
        <div className="flex flex-col h-full gap-4 p-4">
            {/* Procedure header skeleton */}
            <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-8 rounded" />
                <Skeleton className="h-6 w-48" />
            </div>

            {/* Main content - resizable panels skeleton */}
            <ResizablePanels
                className="flex-1"
                first={
                    <Card className="flex flex-col overflow-hidden h-full">
                        <CardHeader className="py-3 px-4 border-b border-border">
                            <CardTitle className="text-sm font-medium">
                                Request
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 p-4 space-y-4">
                            {/* Schema toggle skeleton */}
                            <Skeleton className="h-4 w-24" />
                            {/* Schema box skeleton */}
                            <Skeleton className="h-24 w-full rounded-md" />
                            {/* Input label skeleton */}
                            <Skeleton className="h-4 w-20" />
                            {/* Textarea skeleton */}
                            <Skeleton className="h-28 w-full rounded-md" />
                            {/* Button skeleton */}
                            <Skeleton className="h-11 w-full rounded-md" />
                        </CardContent>
                    </Card>
                }
                second={
                    <Card className="flex flex-col overflow-hidden h-full">
                        <CardHeader className="py-3 px-4 border-b border-border">
                            <CardTitle className="text-sm font-medium">
                                Response
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 p-4 flex items-center justify-center">
                            <Skeleton className="h-4 w-56" />
                        </CardContent>
                    </Card>
                }
            />
        </div>
    );
}

/**
 * Check if an error message looks like a SuperJSON parsing issue.
 * When a server uses SuperJSON but receives plain JSON, it typically fails
 * with "expected object, received undefined" because it looks for { json: ... }
 */
function looksLikeSuperJSONError(message: string | undefined): boolean {
    if (!message) return false;

    // Common error patterns when SuperJSON input is expected but plain JSON is sent
    return (
        message.includes('expected object, received undefined') ||
        message.includes('Invalid input: expected object')
    );
}
