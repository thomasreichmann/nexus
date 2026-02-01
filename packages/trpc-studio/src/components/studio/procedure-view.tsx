'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

            {procedure.description && (
                <p className="text-sm text-muted-foreground">
                    {procedure.description}
                </p>
            )}

            {procedure.tags && procedure.tags.length > 0 && (
                <div className="flex gap-1">
                    {procedure.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
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

            {/* Description skeleton */}
            <Skeleton className="h-4 w-72" />

            {/* Main content grid */}
            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                {/* Request panel skeleton */}
                <Card className="flex flex-col overflow-hidden">
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

                {/* Response panel skeleton */}
                <Card className="flex flex-col overflow-hidden">
                    <CardHeader className="py-3 px-4 border-b border-border">
                        <CardTitle className="text-sm font-medium">
                            Response
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-4 flex items-center justify-center">
                        <Skeleton className="h-4 w-56" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
