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
 * Render a simplified view of a JSON Schema type
 */
function getTypeString(schema: JSONSchema): string {
    if (schema.$ref) {
        // Extract type name from $ref like "#/$defs/MyType"
        const refName = schema.$ref.split('/').pop();
        return refName || 'ref';
    }

    if (schema.anyOf) {
        return schema.anyOf.map(getTypeString).join(' | ');
    }

    if (schema.oneOf) {
        return schema.oneOf.map(getTypeString).join(' | ');
    }

    if (schema.const !== undefined) {
        return JSON.stringify(schema.const);
    }

    if (schema.enum) {
        return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
    }

    if (Array.isArray(schema.type)) {
        return schema.type.join(' | ');
    }

    if (schema.type === 'array') {
        if (schema.items && !Array.isArray(schema.items)) {
            return `${getTypeString(schema.items)}[]`;
        }
        return 'array';
    }

    return schema.type || 'unknown';
}

/**
 * Render schema properties as a tree
 */
function SchemaTree({
    schema,
    defs,
    depth = 0,
}: {
    schema: JSONSchema;
    defs?: Record<string, JSONSchema>;
    depth?: number;
}) {
    const indent = depth * 16;

    // Resolve $ref
    if (schema.$ref && defs) {
        const refName = schema.$ref.split('/').pop();
        if (refName && defs[refName]) {
            return (
                <SchemaTree schema={defs[refName]} defs={defs} depth={depth} />
            );
        }
    }

    // Object type - show properties
    if (schema.type === 'object' && schema.properties) {
        const required = new Set(schema.required || []);
        return (
            <div style={{ marginLeft: indent }}>
                {Object.entries(schema.properties).map(([key, propSchema]) => (
                    <div key={key} className="py-0.5">
                        <span className="text-blue-400">{key}</span>
                        {required.has(key) && (
                            <span className="text-red-400">*</span>
                        )}
                        <span className="text-muted-foreground">: </span>
                        <span className="text-green-400">
                            {getTypeString(propSchema as JSONSchema)}
                        </span>
                        {(propSchema as JSONSchema).description && (
                            <span className="text-muted-foreground text-xs ml-2">
                                // {(propSchema as JSONSchema).description}
                            </span>
                        )}
                        {(propSchema as JSONSchema).type === 'object' &&
                            (propSchema as JSONSchema).properties && (
                                <SchemaTree
                                    schema={propSchema as JSONSchema}
                                    defs={defs}
                                    depth={depth + 1}
                                />
                            )}
                    </div>
                ))}
            </div>
        );
    }

    // Simple type
    return (
        <span className="text-green-400" style={{ marginLeft: indent }}>
            {getTypeString(schema)}
        </span>
    );
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
    const [showSchema, setShowSchema] = React.useState(true);
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
            {/* Schema display */}
            {schema && (
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setShowSchema(!showSchema)}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground/80"
                    >
                        <span
                            className={`text-xs transition-transform ${showSchema ? 'rotate-90' : ''}`}
                        >
                            ▶
                        </span>
                        Input Schema
                    </button>
                    {showSchema && (
                        <div className="font-mono text-xs bg-muted/50 rounded-md p-3 border border-border overflow-auto max-h-[200px]">
                            <SchemaTree schema={schema} defs={schema.$defs} />
                        </div>
                    )}
                </div>
            )}

            {/* Input textarea */}
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                    Input JSON
                </label>
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
                        <p className="text-xs text-destructive">Invalid JSON</p>
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
                <span className="text-xs text-muted-foreground">⌘ + Enter</span>
            </div>
        </div>
    );
}
