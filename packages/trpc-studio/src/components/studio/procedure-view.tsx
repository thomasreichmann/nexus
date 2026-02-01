'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SchemaForm } from './schema-form';
import { ResponseViewer } from './response-viewer';
import { executeRequest, type TRPCResponse } from '@/lib/request';
import { saveToHistory } from '@/lib/storage';
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

    // Reset state when procedure changes
    React.useEffect(() => {
        setInput('');
        setResponse(null);
    }, [procedure.path]);

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

            const result = await executeRequest(
                {
                    path: procedure.path,
                    type: procedure.type,
                    input: parsedInput,
                },
                {
                    trpcUrl,
                    headers,
                }
            );

            setResponse(result);

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
        <div className="flex flex-col h-full gap-4 p-4">
            {/* Procedure header */}
            <div className="flex items-center gap-3">
                <Badge variant={procedure.type} className="text-xs">
                    {procedure.type.toUpperCase()}
                </Badge>
                <code className="font-mono text-lg font-semibold">
                    {procedure.path}
                </code>
            </div>

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

            {/* Main content grid */}
            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                {/* Input panel */}
                <Card className="flex flex-col overflow-hidden">
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
                        />
                    </CardContent>
                </Card>

                {/* Response panel */}
                <Card className="flex flex-col overflow-hidden">
                    <CardHeader className="py-3 px-4 border-b border-border">
                        <CardTitle className="text-sm font-medium">
                            Response
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden">
                        <ResponseViewer response={response} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
