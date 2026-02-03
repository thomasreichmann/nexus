'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TRPCResponse } from '@/lib/request';
import { AnsiText } from '@/components/ui/ansi-text';
import { HighlightedStackTrace } from '@/components/ui/highlighted-stack-trace';
import { hasAnsi } from '@/lib/ansi';

interface ResponseViewerProps {
    response: TRPCResponse | null;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
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

            <ScrollArea className="flex-1">
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                    {response.ok ? (
                        <JsonViewer data={displayData} />
                    ) : (
                        <div className="space-y-2">
                            <div
                                className={`font-semibold whitespace-pre-wrap ${
                                    response.error?.message &&
                                    hasAnsi(response.error.message)
                                        ? ''
                                        : 'text-destructive'
                                }`}
                            >
                                {response.error?.message ? (
                                    <HighlightedStackTrace
                                        message={response.error.message}
                                    />
                                ) : (
                                    'Unknown error'
                                )}
                            </div>
                            {response.error?.code ? (
                                <div className="text-muted-foreground">
                                    Code: {response.error.code}
                                </div>
                            ) : null}
                            {response.error?.data != null ? (
                                <JsonViewer data={response.error.data} />
                            ) : null}
                        </div>
                    )}
                </pre>
            </ScrollArea>
        </motion.div>
    );
}

// Helper component - defined after main export (hoisting allows this)
function JsonViewer({ data, level = 0 }: { data: unknown; level?: number }) {
    const indent = '  '.repeat(level);

    if (data === null) {
        return <span className="text-orange-400">null</span>;
    }

    if (data === undefined) {
        return <span className="text-gray-400">undefined</span>;
    }

    if (typeof data === 'boolean') {
        return <span className="text-purple-400">{data.toString()}</span>;
    }

    if (typeof data === 'number') {
        return <span className="text-blue-400">{data}</span>;
    }

    if (typeof data === 'string') {
        // Don't apply green color to strings with ANSI codes - let the ANSI colors show
        if (hasAnsi(data)) {
            return (
                <span>
                    "<AnsiText>{data}</AnsiText>"
                </span>
            );
        }
        return <span className="text-green-400">"{data}"</span>;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) {
            return <span>[]</span>;
        }

        return (
            <span>
                [
                {data.map((item, i) => (
                    <React.Fragment key={i}>
                        {'\n'}
                        {indent} <JsonViewer data={item} level={level + 1} />
                        {i < data.length - 1 && ','}
                    </React.Fragment>
                ))}
                {'\n'}
                {indent}]
            </span>
        );
    }

    if (typeof data === 'object') {
        const entries = Object.entries(data);
        if (entries.length === 0) {
            return <span>{'{}'}</span>;
        }

        return (
            <span>
                {'{'}
                {entries.map(([key, value], i) => (
                    <React.Fragment key={key}>
                        {'\n'}
                        {indent} <span className="text-cyan-400">"{key}"</span>:{' '}
                        <JsonViewer data={value} level={level + 1} />
                        {i < entries.length - 1 && ','}
                    </React.Fragment>
                ))}
                {'\n'}
                {indent}
                {'}'}
            </span>
        );
    }

    return <span>{String(data)}</span>;
}
