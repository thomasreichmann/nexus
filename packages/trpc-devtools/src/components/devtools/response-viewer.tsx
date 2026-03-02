'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TRPCResponse } from '@/lib/request';
import { HighlightedStackTrace } from '@/components/ui/highlighted-stack-trace';
import { CollapsibleJsonViewer } from '@/components/ui/collapsible-json-viewer';
import { hasAnsi } from '@/lib/ansi';
import { formatIssuePath, type ZodIssue } from '@/lib/zod-error';

interface ResponseViewerProps {
    response: TRPCResponse | null;
    zodIssues?: ZodIssue[] | null;
    fromHistory?: boolean;
}

export function ResponseViewer({
    response,
    zodIssues,
    fromHistory,
}: ResponseViewerProps) {
    const [showRaw, setShowRaw] = React.useState(false);

    if (!response) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Execute a procedure to see the response
            </div>
        );
    }

    const displayData = showRaw ? response.rawResponse : response.data;

    return (
        <motion.div
            key={response.timing.startedAt}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex flex-col h-full"
        >
            <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <Badge
                        variant={response.ok ? 'secondary' : 'destructive'}
                        className="text-xs"
                    >
                        {response.ok ? 'Success' : 'Error'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                        {response.timing.durationMs}ms
                    </span>
                    {fromHistory && (
                        <Badge variant="outline" className="text-xs">
                            Historical
                        </Badge>
                    )}
                    {response.usedSuperJSON && (
                        <Badge variant="outline" className="text-xs">
                            SuperJSON
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        variant={showRaw ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setShowRaw(!showRaw)}
                    >
                        {showRaw ? 'Parsed' : 'Raw'}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            navigator.clipboard.writeText(
                                JSON.stringify(displayData, null, 2)
                            );
                        }}
                    >
                        Copy
                    </Button>
                </div>
            </div>

            {response.ok ? (
                <CollapsibleJsonViewer data={displayData} className="flex-1" />
            ) : showRaw ? (
                <RawErrorView error={response.error} />
            ) : zodIssues ? (
                <ZodErrorView issues={zodIssues} code={response.error?.code} />
            ) : (
                <RawErrorView error={response.error} />
            )}
        </motion.div>
    );
}

// --- Helper components ---

function RawErrorView({ error }: { error: TRPCResponse['error'] }) {
    return (
        <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
                <div
                    className={`font-semibold whitespace-pre-wrap font-mono text-sm ${
                        error?.message && hasAnsi(error.message)
                            ? ''
                            : 'text-destructive'
                    }`}
                >
                    {error?.message ? (
                        <HighlightedStackTrace message={error.message} />
                    ) : (
                        'Unknown error'
                    )}
                </div>
                {error?.code ? (
                    <div className="text-muted-foreground text-sm">
                        Code: {error.code}
                    </div>
                ) : null}
                {error?.data != null ? (
                    <div className="border-t border-border pt-4">
                        <div className="text-xs text-muted-foreground mb-2">
                            Error Data
                        </div>
                        <CollapsibleJsonViewer
                            data={error.data}
                            className="border border-border rounded-md"
                        />
                    </div>
                ) : null}
            </div>
        </ScrollArea>
    );
}

function ZodErrorView({ issues, code }: { issues: ZodIssue[]; code?: string }) {
    return (
        <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-destructive">
                        Validation Failed
                    </span>
                    <Badge variant="destructive" className="text-xs">
                        {issues.length}{' '}
                        {issues.length === 1 ? 'issue' : 'issues'}
                    </Badge>
                    {code && (
                        <span className="text-xs text-muted-foreground">
                            {code}
                        </span>
                    )}
                </div>

                <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted/50">
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                                    Field
                                </th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                                    Error
                                </th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                                    Code
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {issues.map((issue, i) => (
                                <tr
                                    key={i}
                                    className="border-b border-border last:border-b-0"
                                >
                                    <td className="px-3 py-2 align-top">
                                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
                                            {formatIssuePath(issue.path)}
                                        </code>
                                    </td>
                                    <td className="px-3 py-2 align-top text-destructive">
                                        {issue.message}
                                        {issue.expected && issue.received && (
                                            <span className="block text-xs text-muted-foreground mt-0.5">
                                                expected {issue.expected}, got{' '}
                                                {issue.received}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 align-top text-xs text-muted-foreground font-mono">
                                        {issue.code}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </ScrollArea>
    );
}
