export async function retryAsync<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelayMs = 1000,
    // Lets callers bail out of the retry loop early for errors retrying can't
    // fix — e.g. an aborted upload, or an expired URL that must be re-presigned
    // before another attempt is worthwhile.
    shouldRetry: (error: unknown) => boolean = () => true
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }
            const delay = baseDelayMs * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
