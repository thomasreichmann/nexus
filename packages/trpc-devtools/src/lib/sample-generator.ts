import type { JSONSchema } from '@/server/types';

/**
 * Generate sample data from a JSON Schema
 * Uses default values when available, otherwise generates type-appropriate placeholders
 */
export function generateSample(
    schema: JSONSchema | null,
    defs?: Record<string, JSONSchema>
): unknown {
    if (!schema) return undefined;

    // Handle default values
    if (schema.default !== undefined) {
        return schema.default;
    }

    // Handle $ref
    if (schema.$ref && defs) {
        const refName = schema.$ref.split('/').pop();
        if (refName && defs[refName]) {
            return generateSample(defs[refName], defs);
        }
    }

    // Handle const
    if (schema.const !== undefined) {
        return schema.const;
    }

    // Handle enum - use first value
    if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0];
    }

    // Handle anyOf/oneOf - use first option
    if (schema.anyOf && schema.anyOf.length > 0) {
        return generateSample(schema.anyOf[0], defs);
    }
    if (schema.oneOf && schema.oneOf.length > 0) {
        return generateSample(schema.oneOf[0], defs);
    }

    // Handle union types (e.g., ["string", "null"])
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    switch (type) {
        case 'object':
            return generateObjectSample(schema, defs);
        case 'array':
            return generateArraySample(schema, defs);
        case 'string':
            return '';
        case 'number':
        case 'integer':
            return 0;
        case 'boolean':
            return false;
        case 'null':
            return null;
        default:
            return undefined;
    }
}

function generateObjectSample(
    schema: JSONSchema,
    defs?: Record<string, JSONSchema>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (!schema.properties) {
        return result;
    }

    // Include required properties and optionally include optional ones
    const required = new Set(schema.required || []);

    for (const [key, propSchema] of Object.entries(schema.properties)) {
        // Always include required fields, skip optional ones for cleaner output
        if (required.has(key)) {
            result[key] = generateSample(propSchema as JSONSchema, defs);
        }
    }

    // If no required fields, include first few optional fields
    if (Object.keys(result).length === 0) {
        const entries = Object.entries(schema.properties).slice(0, 3);
        for (const [key, propSchema] of entries) {
            result[key] = generateSample(propSchema as JSONSchema, defs);
        }
    }

    return result;
}

function generateArraySample(
    schema: JSONSchema,
    defs?: Record<string, JSONSchema>
): unknown[] {
    if (!schema.items) {
        return [];
    }

    // Handle tuple types
    if (Array.isArray(schema.items)) {
        return schema.items.map((item) =>
            generateSample(item as JSONSchema, defs)
        );
    }

    // Single item type - generate one sample element
    return [generateSample(schema.items, defs)];
}

/**
 * Parse JSON and return error with line/column position
 */
export function parseJsonWithPosition(
    input: string
): { ok: true; data: unknown } | { ok: false; error: string } {
    if (!input.trim()) {
        return { ok: true, data: undefined };
    }

    try {
        const data = JSON.parse(input);
        return { ok: true, data };
    } catch (e) {
        if (e instanceof SyntaxError) {
            const message = e.message;
            // Try to extract position from error message
            // Common formats:
            // "Unexpected token } at position 42"
            // "Expected property name or '}' at position 15"
            const posMatch = message.match(/at position (\d+)/i);

            if (posMatch) {
                const position = parseInt(posMatch[1], 10);
                const { line, column } = getLineColumn(input, position);
                return {
                    ok: false,
                    error: `Invalid JSON at line ${line}, column ${column}`,
                };
            }

            return { ok: false, error: `Invalid JSON: ${message}` };
        }
        return { ok: false, error: 'Invalid JSON' };
    }
}

function getLineColumn(
    str: string,
    position: number
): { line: number; column: number } {
    const lines = str.slice(0, position).split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return { line, column };
}
