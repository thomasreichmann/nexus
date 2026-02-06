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

            {response.ok ? (
                <CollapsibleJsonViewer data={displayData} className="flex-1" />
            ) : (
                <ScrollArea className="flex-1">
                    <div className="p-4 space-y-4">
                        <div
                            className={`font-semibold whitespace-pre-wrap font-mono text-sm ${
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
                            <div className="text-muted-foreground text-sm">
                                Code: {response.error.code}
                            </div>
                        ) : null}
                        {response.error?.data != null ? (
                            <div className="border-t border-border pt-4">
                                <div className="text-xs text-muted-foreground mb-2">
                                    Error Data
                                </div>
                                <CollapsibleJsonViewer
                                    data={response.error.data}
                                    className="border border-border rounded-md"
                                />
                            </div>
                        ) : null}
                    </div>
                </ScrollArea>
            )}
        </motion.div>
    );
}
