'use client';

import * as React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { JSONSchema } from '@/server/types';

interface SchemaFormProps {
    schema: JSONSchema | null;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    isLoading?: boolean;
    procedureType: 'query' | 'mutation' | 'subscription';
}

/**
 * Render a form from a JSON Schema
 * For MVP, we use a JSON textarea - more sophisticated form generation comes later
 */
export function SchemaForm({
    schema,
    value,
    onChange,
    onSubmit,
    isLoading,
    procedureType,
}: SchemaFormProps) {
    const hasInput = schema !== null;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Cmd/Ctrl + Enter to submit
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
        }
    };

    const validateJson = (val: string): boolean => {
        if (!val.trim()) return true;
        try {
            JSON.parse(val);
            return true;
        } catch {
            return false;
        }
    };

    const isValid = validateJson(value);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                    Input
                </label>
                {schema && (
                    <span className="text-xs text-muted-foreground">
                        JSON Schema available
                    </span>
                )}
            </div>

            {hasInput ? (
                <div className="space-y-2">
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder='{"key": "value"}'
                        className={`font-mono text-sm min-h-[120px] ${
                            !isValid ? 'border-destructive' : ''
                        }`}
                        disabled={isLoading}
                    />
                    {!isValid && (
                        <p className="text-xs text-destructive">
                            Invalid JSON
                        </p>
                    )}
                </div>
            ) : (
                <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-md">
                    No input required
                </div>
            )}

            <div className="flex items-center gap-2">
                <Button
                    onClick={onSubmit}
                    disabled={isLoading || !isValid}
                    className="flex-1"
                >
                    {isLoading ? (
                        <>
                            <span className="animate-spin mr-2">⏳</span>
                            Executing...
                        </>
                    ) : (
                        `Execute ${procedureType === 'query' ? 'Query' : 'Mutation'}`
                    )}
                </Button>
                <span className="text-xs text-muted-foreground">
                    ⌘ + Enter
                </span>
            </div>
        </div>
    );
}
