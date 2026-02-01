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
 * Extract procedure type from tRPC procedure definition
 */
function getProcedureType(procedure: unknown): ProcedureType | null {
    if (
        typeof procedure !== 'object' ||
        procedure === null ||
        !('_def' in procedure)
    ) {
        return null;
    }

    const def = (procedure as { _def: { type?: string } })._def;

    if (def.type === 'query') return 'query';
    if (def.type === 'mutation') return 'mutation';
    if (def.type === 'subscription') return 'subscription';

    return null;
}

/**
 * Extract input schema from procedure
 */
function extractInputSchema(procedure: unknown): JSONSchema | null {
    if (
        typeof procedure !== 'object' ||
        procedure === null ||
        !('_def' in procedure)
    ) {
        return null;
    }

    const def = (procedure as { _def: { inputs?: unknown[] } })._def;
    const inputs = def.inputs;

    if (!Array.isArray(inputs) || inputs.length === 0) {
        return null;
    }

    // tRPC v11 stores inputs as an array of validators
    // Usually there's just one, but they can be chained
    // We'll use the first one for now
    return extractJsonSchema(inputs[0]);
}

/**
 * Extract output schema from procedure if defined
 */
function extractOutputSchema(procedure: unknown): JSONSchema | null {
    if (
        typeof procedure !== 'object' ||
        procedure === null ||
        !('_def' in procedure)
    ) {
        return null;
    }

    const def = (procedure as { _def: { output?: unknown } })._def;

    if (!def.output) {
        return null;
    }

    return extractJsonSchema(def.output);
}

/**
 * Extract metadata from procedure
 */
function extractMeta(procedure: unknown): {
    description?: string;
    tags?: string[];
} {
    if (
        typeof procedure !== 'object' ||
        procedure === null ||
        !('_def' in procedure)
    ) {
        return {};
    }

    const def = (procedure as { _def: { meta?: Record<string, unknown> } })
        ._def;
    const meta = def.meta;

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
 * Check if a value is a router (has nested procedures)
 */
function isRouter(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !('_def' in value)) {
        return false;
    }

    const def = (value as { _def: { router?: boolean } })._def;
    return def.router === true;
}

/**
 * Recursively walk a router and extract all procedure schemas
 */
function walkRouter(router: unknown, prefix: string = ''): ProcedureSchema[] {
    const procedures: ProcedureSchema[] = [];

    if (typeof router !== 'object' || router === null || !('_def' in router)) {
        return procedures;
    }

    const def = (router as { _def: { procedures?: Record<string, unknown> } })
        ._def;
    const procs = def.procedures;

    if (!procs || typeof procs !== 'object') {
        return procedures;
    }

    for (const [key, value] of Object.entries(procs)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (isRouter(value)) {
            // Recursively process nested routers
            procedures.push(...walkRouter(value, path));
        } else {
            // It's a procedure
            const type = getProcedureType(value);

            if (type) {
                const inputSchema = extractInputSchema(value);
                const outputSchema = extractOutputSchema(value);
                const meta = extractMeta(value);

                procedures.push({
                    path,
                    type,
                    inputSchema,
                    outputSchema,
                    ...meta,
                });
            }
        }
    }

    return procedures;
}

/**
 * Introspect a tRPC router and extract schemas for all procedures
 */
export function introspectRouter<TRouter extends AnyRouter>(
    router: TRouter
): RouterSchema {
    const procedures = walkRouter(router);

    return {
        procedures,
        version: 1,
        generatedAt: new Date().toISOString(),
    };
}
