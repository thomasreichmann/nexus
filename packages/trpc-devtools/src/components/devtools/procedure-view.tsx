'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Check, Download, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResizablePanels } from '@/components/ui/resizable-panels';
import { Skeleton } from '@/components/ui/skeleton';
import { SchemaForm } from './schema-form';
import { ResponseViewer } from './response-viewer';
import { buildCurlCommand } from '@/lib/curl';
import { executeRequest, type TRPCResponse } from '@/lib/request';
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard';
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
    historyReplay?: { input: string; response: TRPCResponse | null } | null;
    onHistoryConsumed?: () => void;
}

/** Imperative surface for global shortcuts and command palette actions */
export interface ProcedureViewHandle {
    execute: () => void;
    clearResponse: () => void;
    toggleRaw: () => void;
    copyCurl: () => void;
}

export const ProcedureView = React.forwardRef<
    ProcedureViewHandle,
    ProcedureViewProps
>(function ProcedureView(
    { procedure, trpcUrl, headers, historyReplay, onHistoryConsumed },
    ref
) {
    const [input, setInput] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const [response, setResponse] = React.useState<TRPCResponse | null>(null);
    const [isFromHistory, setIsFromHistory] = React.useState(false);
    const [showRaw, setShowRaw] = React.useState(false);
    const [includeCookies, setIncludeCookies] = React.useState(false);
    const { isCopied: isCurlCopied, copy: copyToClipboard } =
        useCopyToClipboard();

    // Track whether we just consumed a history replay (to skip the reset
    // triggered by onHistoryConsumed setting historyReplay back to null)
    const wasReplayRef = React.useRef(false);

    // Track SuperJSON preference - load from storage on mount
    const [useSuperJSON, setUseSuperJSON] = React.useState<boolean>(() => {
        // Default to stored preference, or false if unknown
        return loadSuperJSONPreference(trpcUrl) ?? false;
    });

    // Reset state when procedure changes, or seed from history replay
    React.useEffect(() => {
        if (historyReplay) {
            setInput(historyReplay.input);
            setResponse(historyReplay.response);
            setIsFromHistory(true);
            wasReplayRef.current = true;
            onHistoryConsumed?.();
        } else if (wasReplayRef.current) {
            // Skip reset — this is just the consumption clearing historyReplay
            wasReplayRef.current = false;
        } else {
            setInput('');
            setResponse(null);
            setIsFromHistory(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally reset on path change or history replay
    }, [procedure.path, historyReplay]);

    const validationErrors = response?.error
        ? parseZodError(response.error)
        : null;

    const handleSubmit = async () => {
        if (procedure.type === 'subscription') {
            // Subscriptions not supported in MVP
            return;
        }

        setIsLoading(true);
        setIsFromHistory(false);

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

    // Input parsed for cURL export; ok=false means unparsable (button disabled)
    const curlInput = React.useMemo(() => {
        if (!input.trim()) return { ok: true as const, value: undefined };
        try {
            return { ok: true as const, value: JSON.parse(input) as unknown };
        } catch {
            return { ok: false as const, value: undefined };
        }
    }, [input]);

    const canCopyCurl = procedure.type !== 'subscription' && curlInput.ok;

    const handleCopyCurl = () => {
        if (procedure.type === 'subscription' || !curlInput.ok) return;

        const command = buildCurlCommand(
            {
                path: procedure.path,
                type: procedure.type,
                input: curlInput.value,
            },
            {
                trpcUrl,
                origin: window.location.origin,
                headers,
                useSuperJSON,
                cookieHeader: includeCookies ? document.cookie : undefined,
            }
        );
        copyToClipboard(command);
    };

    const handleDownload = () => {
        if (!response) return;

        // Mirror what the viewer currently shows: raw wire response, or the
        // parsed data / error
        const data = showRaw
            ? response.rawResponse
            : response.ok
              ? response.data
              : response.error;

        const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${procedure.path}-response.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    React.useImperativeHandle(ref, () => ({
        execute: () => void handleSubmit(),
        clearResponse: () => {
            setResponse(null);
            setIsFromHistory(false);
        },
        toggleRaw: () => setShowRaw((prev) => !prev),
        copyCurl: handleCopyCurl,
    }));

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
                        <CardHeader className="py-2 px-4 border-b border-border">
                            <div className="flex items-center justify-between gap-2 min-h-7">
                                <CardTitle className="text-sm font-medium">
                                    Request
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <label
                                        className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground"
                                        title="Include browser cookies in the cURL command (only cookies readable by JavaScript)"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={includeCookies}
                                            onChange={(e) =>
                                                setIncludeCookies(
                                                    e.target.checked
                                                )
                                            }
                                            className="h-3.5 w-3.5 accent-primary"
                                        />
                                        Cookies
                                    </label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleCopyCurl}
                                        disabled={!canCopyCurl}
                                        title="Copy request as cURL command"
                                        className="h-7 gap-1.5 px-2 text-xs"
                                    >
                                        {isCurlCopied ? (
                                            <Check className="h-3.5 w-3.5" />
                                        ) : (
                                            <Terminal className="h-3.5 w-3.5" />
                                        )}
                                        {isCurlCopied ? 'Copied!' : 'cURL'}
                                    </Button>
                                </div>
                            </div>
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
                        <CardHeader className="py-2 px-4 border-b border-border">
                            <div className="flex items-center justify-between gap-2 min-h-7">
                                <CardTitle className="text-sm font-medium">
                                    Response
                                </CardTitle>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleDownload}
                                    disabled={!response}
                                    title={`Download response as ${procedure.path}-response.json`}
                                    className="h-7 gap-1.5 px-2 text-xs"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 overflow-hidden">
                            <ResponseViewer
                                response={response}
                                zodIssues={validationErrors}
                                fromHistory={isFromHistory}
                                showRaw={showRaw}
                                onToggleRaw={() => setShowRaw((prev) => !prev)}
                            />
                        </CardContent>
                    </Card>
                }
            />
        </motion.div>
    );
});

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
