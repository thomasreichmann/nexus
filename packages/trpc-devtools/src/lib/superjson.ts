/**
 * SuperJSON detection and handling utilities
 *
 * tRPC often uses SuperJSON for serialization which wraps responses in a
 * { json: ..., meta: ... } structure. We need to detect and unwrap this.
 */

export interface SuperJSONResult {
    json: unknown;
    meta?: {
        values?: Record<string, unknown>;
        referentialEqualities?: Record<string, unknown>;
    };
}

/**
 * Check if a value looks like a SuperJSON-wrapped response
 */
export function isSuperJSONResult(value: unknown): value is SuperJSONResult {
    return (
        typeof value === 'object' &&
        value !== null &&
        'json' in value &&
        (('meta' in value &&
            typeof (value as SuperJSONResult).meta === 'object') ||
            !('meta' in value))
    );
}

/**
 * Attempt to deserialize a SuperJSON result
 * For now, we just extract the json property - full deserialization
 * would require the superjson library
 */
export function unwrapSuperJSON(value: unknown): unknown {
    if (isSuperJSONResult(value)) {
        return value.json;
    }
    return value;
}

/**
 * Detect if an endpoint is using SuperJSON by checking response format
 */
export function detectSuperJSON(response: unknown): boolean {
    return isSuperJSONResult(response);
}
