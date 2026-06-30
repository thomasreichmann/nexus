import { describe, expect, it, vi } from 'vitest';
import { retryAsync } from './retry';

describe('retryAsync', () => {
    it('returns the result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');

        await expect(retryAsync(fn, 3, 0)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries up to maxRetries then throws the last error', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('boom'));

        await expect(retryAsync(fn, 2, 0)).rejects.toThrow('boom');
        // initial attempt + 2 retries
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('recovers when a later attempt succeeds', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue('ok');

        await expect(retryAsync(fn, 3, 0)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('bails out immediately when shouldRetry returns false', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fatal'));
        const shouldRetry = vi.fn().mockReturnValue(false);

        await expect(retryAsync(fn, 5, 0, shouldRetry)).rejects.toThrow(
            'fatal'
        );
        // No retries — the predicate vetoed them.
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
