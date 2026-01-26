/**
 * Safely call a function and return a fallback value if it throws or returns null/undefined.
 */
export function safeGet<T>(fn: () => T | null | undefined, fallback: T): T {
    try {
        const result = fn();
        return result ?? fallback;
    } catch {
        return fallback;
    }
}
