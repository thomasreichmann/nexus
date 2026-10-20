import { describe, expect, it } from 'vitest';
import { isLockTimeout } from './migrateWithLockRetry';

describe('isLockTimeout', () => {
    it.each([
        [
            'a lock timeout, as drizzle wraps it',
            { cause: { code: '55P03' } },
            true,
        ],
        ['another Postgres error', { cause: { code: '42P01' } }, false],
        // e.g. a missing migrations journal, thrown before any query runs
        ['an error with no cause', new Error('no journal'), false],
    ])('%s → %s', (_name, err, expected) => {
        expect(isLockTimeout(err)).toBe(expected);
    });
});
