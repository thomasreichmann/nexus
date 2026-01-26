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

/**
 * Evict oldest entries when cache exceeds max size.
 * Uses insertion order (Map iteration order) as a simple approximation of LRU.
 */
export function evictOldEntries<K, V>(cache: Map<K, V>, maxSize: number): void {
    if (cache.size <= maxSize) return;
    const entriesToDelete = Math.floor(maxSize * 0.5);
    const iterator = cache.keys();
    for (let i = 0; i < entriesToDelete; i++) {
        const key = iterator.next().value;
        if (key !== undefined) cache.delete(key);
    }
}
