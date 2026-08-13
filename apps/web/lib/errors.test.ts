import { describe, expect, it } from 'vitest';
import {
    isTransientInfraError,
    isUniqueViolation,
    toErrorMessage,
} from './errors';

function withCode(message: string, code: unknown): Error {
    return Object.assign(new Error(message), { code });
}

describe('toErrorMessage', () => {
    it('takes the message off an Error', () => {
        expect(toErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('stringifies anything else', () => {
        expect(toErrorMessage('plain string')).toBe('plain string');
        expect(toErrorMessage(undefined)).toBe('undefined');
    });
});

describe('isUniqueViolation', () => {
    it('matches Postgres 23505', () => {
        expect(isUniqueViolation(withCode('duplicate key', '23505'))).toBe(
            true
        );
    });

    it('ignores other Postgres codes', () => {
        expect(isUniqueViolation(withCode('bad column', '42703'))).toBe(false);
    });

    it('ignores an error with no code at all', () => {
        expect(isUniqueViolation(new Error('duplicate key'))).toBe(false);
    });
});

describe('isTransientInfraError', () => {
    it('matches a Node socket code on the error itself', () => {
        expect(
            isTransientInfraError(withCode('connect failed', 'ECONNREFUSED'))
        ).toBe(true);
    });

    it('matches a postgres.js connection state', () => {
        expect(
            isTransientInfraError(withCode('ended', 'CONNECTION_ENDED'))
        ).toBe(true);
    });

    it('matches the whole Postgres class-08 family by prefix', () => {
        for (const code of ['08000', '08003', '08006', '08P01']) {
            expect(isTransientInfraError(withCode('conn', code))).toBe(true);
        }
    });

    it('matches the named recoverable server states', () => {
        for (const code of ['53300', '57P01', '40001', '40P01']) {
            expect(isTransientInfraError(withCode('server', code))).toBe(true);
        }
    });

    it('finds a code one cause level down', () => {
        // How undici reports a refused connection.
        const err = new TypeError('fetch failed', {
            cause: withCode('connect ECONNREFUSED', 'ECONNREFUSED'),
        });

        expect(isTransientInfraError(err)).toBe(true);
    });

    it('finds a code several cause levels down', () => {
        const err = new Error('outer', {
            cause: new Error('middle', {
                cause: withCode('inner', 'ETIMEDOUT'),
            }),
        });

        expect(isTransientInfraError(err)).toBe(true);
    });

    it('terminates on a self-referential cause chain', () => {
        const err: Error & { cause?: unknown } = new Error('loop');
        err.cause = err;

        expect(isTransientInfraError(err)).toBe(false);
    });

    it('treats an unrecognised code as a business error', () => {
        expect(isTransientInfraError(withCode('bad column', '42703'))).toBe(
            false
        );
        expect(isTransientInfraError(withCode('unique', '23505'))).toBe(false);
    });

    it('ignores a non-string code', () => {
        expect(isTransientInfraError(withCode('numeric', 500))).toBe(false);
    });

    it('handles values that are not errors', () => {
        expect(isTransientInfraError('ECONNREFUSED')).toBe(false);
        expect(isTransientInfraError(null)).toBe(false);
        expect(isTransientInfraError(undefined)).toBe(false);
    });
});
