import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';
import type {
    JSONSchema,
    ProcedureSchema,
    ProcedureType,
    RouterSchema,
} from './types';

/**
 * Check if a value is a Zod schema by looking for the parse method
 */
function isZodSchema(value: unknown): value is z.ZodType {
    return (
        typeof value === 'object' &&
        value !== null &&
        'parse' in value &&
        typeof (value as { parse: unknown }).parse === 'function' &&
        '_def' in value
    );
}

/**
 * Extract JSON Schema from a Zod validator using native z.toJSONSchema()
 * Falls back gracefully if the schema can't be converted
 */
function extractJsonSchema(validator: unknown): JSONSchema | null {
    if (!isZodSchema(validator)) {
        return null;
    }

    try {
        // Use Zod v4's native toJSONSchema
        return z.toJSONSchema(validator) as JSONSchema;
    } catch {
        // Schema might not be convertible (e.g., has transforms)
        return null;
    }
}

/**
 * tRPC v11 procedure definition structure
 */
interface ProcedureDef {
    type?: 'query' | 'mutation' | 'subscription';
    inputs?: unknown[];
    output?: unknown;
    meta?: Record<string, unknown>;
}

/**
 * tRPC v11 procedure (callable with _def)
 */
interface TRPCProcedure {
    _def?: ProcedureDef;
}

/**
 * tRPC v11 router definition structure
 */
interface RouterDef {
    procedures?: Record<string, TRPCProcedure>;
    record?: Record<string, unknown>;
}

/**
 * Extract procedure type from tRPC procedure definition
 */
function getProcedureType(procedureDef: ProcedureDef): ProcedureType | null {
    if (procedureDef.type === 'query') return 'query';
    if (procedureDef.type === 'mutation') return 'mutation';
    if (procedureDef.type === 'subscription') return 'subscription';
    return null;
}

/**
 * Extract input schema from procedure definition
 */
function extractInputSchema(procedureDef: ProcedureDef): JSONSchema | null {
    const inputs = procedureDef.inputs;

    if (!Array.isArray(inputs) || inputs.length === 0) {
        return null;
    }

    // tRPC v11 stores inputs as an array of validators
    // Usually there's just one, but they can be chained
    // We'll use the first one for now
    return extractJsonSchema(inputs[0]);
}

/**
 * Extract output schema from procedure definition if defined
 */
function extractOutputSchema(procedureDef: ProcedureDef): JSONSchema | null {
    if (!procedureDef.output) {
        return null;
    }

    return extractJsonSchema(procedureDef.output);
}

/**
 * Extract metadata from procedure definition
 */
function extractMeta(procedureDef: ProcedureDef): {
    description?: string;
    tags?: string[];
} {
    const meta = procedureDef.meta;

    if (!meta || typeof meta !== 'object') {
        return {};
    }

    const result: { description?: string; tags?: string[] } = {};

    if (typeof meta.description === 'string') {
        result.description = meta.description;
    }

    if (Array.isArray(meta.tags)) {
        result.tags = meta.tags.filter(
            (t): t is string => typeof t === 'string'
        );
    }

    return result;
}

/**
 * Introspect a tRPC v11 router and extract schemas for all procedures
 *
 * tRPC v11 stores procedures in a flat map at router._def.procedures
 * with dot-notated keys (e.g., "files.list", "auth.me")
 */
export function introspectRouter<TRouter extends AnyRouter>(
    router: TRouter
): RouterSchema {
    const procedures: ProcedureSchema[] = [];

    // Access the router definition
    const routerDef = (router as unknown as { _def?: RouterDef })._def;

    if (!routerDef?.procedures) {
        return {
            procedures,
            version: 1,
            generatedAt: new Date().toISOString(),
        };
    }

    // Iterate over all procedures (they're stored flat with dot notation)
    for (const [path, procedure] of Object.entries(routerDef.procedures)) {
        const procDef = procedure?._def;

        if (!procDef) {
            continue;
        }

        const type = getProcedureType(procDef);

        if (!type) {
            continue;
        }

        const inputSchema = extractInputSchema(procDef);
        const outputSchema = extractOutputSchema(procDef);
        const meta = extractMeta(procDef);

        procedures.push({
            path,
            type,
            inputSchema,
            outputSchema,
            ...meta,
        });
    }

    // Sort procedures alphabetically by path
    procedures.sort((a, b) => a.path.localeCompare(b.path));

    return {
        procedures,
        version: 1,
        generatedAt: new Date().toISOString(),
    };
}
