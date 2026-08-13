/**
 * Narrows an unknown thrown value to a message string. Anything can be thrown,
 * but the places that record failures — webhook `error` columns, alert context,
 * retrieval `errorMessage` — all need a plain string.
 */
export function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
