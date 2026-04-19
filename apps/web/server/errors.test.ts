import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES, type DomainErrorCode } from '@/lib/errors/codes';
import {
    DomainError,
    NotFoundError,
    ForbiddenError,
    InvalidStateError,
    QuotaExceededError,
    TrialExpiredError,
    isDomainError,
} from './errors';

describe('DOMAIN_ERROR_CODES registry', () => {
    it('has an entry for every subclass', () => {
        expect(DOMAIN_ERROR_CODES).toStrictEqual({
            NOT_FOUND: 'NOT_FOUND',
            INVALID_STATE: 'INVALID_STATE',
            FORBIDDEN: 'FORBIDDEN',
            QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        });
    });

    it('DomainErrorCode is exhaustive over the registry values', () => {
        // Compile-time check: a switch over DomainErrorCode must handle every
        // registry entry. Adding a new code without updating this switch is a
        // compile error (TS2366 / TS2367).
        function exhaustive(code: DomainErrorCode): string {
            switch (code) {
                case 'NOT_FOUND':
                case 'INVALID_STATE':
                case 'FORBIDDEN':
                case 'QUOTA_EXCEEDED':
                case 'TRIAL_EXPIRED':
                    return code;
            }
        }
        for (const code of Object.values(DOMAIN_ERROR_CODES)) {
            expect(exhaustive(code)).toBe(code);
        }
    });
});

describe('DomainError', () => {
    it('is an instance of Error', () => {
        const error = new NotFoundError('File');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(DomainError);
    });

    it('sets the constructor name', () => {
        expect(new NotFoundError('File').name).toBe('NotFoundError');
        expect(new ForbiddenError().name).toBe('ForbiddenError');
        expect(new InvalidStateError('msg').name).toBe('InvalidStateError');
        expect(new QuotaExceededError().name).toBe('QuotaExceededError');
        expect(new TrialExpiredError().name).toBe('TrialExpiredError');
    });
});

describe('NotFoundError', () => {
    it('declares a static code matching the registry', () => {
        expect(NotFoundError.code).toBe(DOMAIN_ERROR_CODES.NOT_FOUND);
    });

    it('maps to NOT_FOUND tRPC code and NOT_FOUND domain code', () => {
        const error = new NotFoundError('File');

        expect(error.trpcCode).toBe('NOT_FOUND');
        expect(error.code).toBe('NOT_FOUND');
    });

    it('formats message with entity only', () => {
        const error = new NotFoundError('File');

        expect(error.message).toBe('File not found');
    });

    it('formats message with entity and id', () => {
        const error = new NotFoundError('File', 'abc-123');

        expect(error.message).toBe('File not found: abc-123');
    });
});

describe('ForbiddenError', () => {
    it('declares a static code matching the registry', () => {
        expect(ForbiddenError.code).toBe(DOMAIN_ERROR_CODES.FORBIDDEN);
    });

    it('maps to FORBIDDEN tRPC code and FORBIDDEN domain code', () => {
        const error = new ForbiddenError();

        expect(error.trpcCode).toBe('FORBIDDEN');
        expect(error.code).toBe('FORBIDDEN');
    });

    it('uses default message when none provided', () => {
        const error = new ForbiddenError();

        expect(error.message).toBe(
            'You do not have permission to perform this action'
        );
    });

    it('uses custom message when provided', () => {
        const error = new ForbiddenError('Cannot delete admin user');

        expect(error.message).toBe('Cannot delete admin user');
    });
});

describe('InvalidStateError', () => {
    it('declares a static code matching the registry', () => {
        expect(InvalidStateError.code).toBe(DOMAIN_ERROR_CODES.INVALID_STATE);
    });

    it('maps to BAD_REQUEST tRPC code and INVALID_STATE domain code', () => {
        const error = new InvalidStateError('Operation not allowed');

        expect(error.trpcCode).toBe('BAD_REQUEST');
        expect(error.code).toBe('INVALID_STATE');
    });

    it('uses provided message', () => {
        const error = new InvalidStateError('Retrieval already in progress');

        expect(error.message).toBe('Retrieval already in progress');
    });
});

describe('QuotaExceededError', () => {
    it('declares a static code matching the registry', () => {
        expect(QuotaExceededError.code).toBe(DOMAIN_ERROR_CODES.QUOTA_EXCEEDED);
    });

    it('maps to PRECONDITION_FAILED tRPC code and QUOTA_EXCEEDED domain code', () => {
        const error = new QuotaExceededError();

        expect(error.trpcCode).toBe('PRECONDITION_FAILED');
        expect(error.code).toBe('QUOTA_EXCEEDED');
    });

    it('uses default message when none provided', () => {
        const error = new QuotaExceededError();

        expect(error.message).toBe('Quota exceeded');
    });

    it('uses custom message when provided', () => {
        const error = new QuotaExceededError('Storage quota exceeded');

        expect(error.message).toBe('Storage quota exceeded');
    });
});

describe('TrialExpiredError', () => {
    it('declares a static code matching the registry', () => {
        expect(TrialExpiredError.code).toBe(DOMAIN_ERROR_CODES.TRIAL_EXPIRED);
    });

    it('maps FORBIDDEN tRPC code but distinct TRIAL_EXPIRED domain code', () => {
        const error = new TrialExpiredError();

        expect(error.trpcCode).toBe('FORBIDDEN');
        expect(error.code).toBe('TRIAL_EXPIRED');
    });

    it('uses default message when none provided', () => {
        const error = new TrialExpiredError();

        expect(error.message).toBe('Your trial has expired');
    });

    it('uses custom message when provided', () => {
        const error = new TrialExpiredError('Please upgrade to continue');

        expect(error.message).toBe('Please upgrade to continue');
    });
});

describe('isDomainError', () => {
    it('returns true for DomainError subclasses', () => {
        expect(isDomainError(new NotFoundError('File'))).toBe(true);
        expect(isDomainError(new ForbiddenError())).toBe(true);
        expect(isDomainError(new InvalidStateError('msg'))).toBe(true);
        expect(isDomainError(new QuotaExceededError())).toBe(true);
        expect(isDomainError(new TrialExpiredError())).toBe(true);
    });

    it('returns false for regular Error', () => {
        expect(isDomainError(new Error('generic'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
        expect(isDomainError(null)).toBe(false);
        expect(isDomainError(undefined)).toBe(false);
        expect(isDomainError('string')).toBe(false);
        expect(isDomainError({ trpcCode: 'NOT_FOUND' })).toBe(false);
    });

    it('returns false for half-shaped errors (trpcCode without code)', () => {
        const halfMigrated = Object.assign(new Error('msg'), {
            trpcCode: 'FORBIDDEN',
        });

        expect(isDomainError(halfMigrated)).toBe(false);
    });

    it('returns false for half-shaped errors (code without trpcCode)', () => {
        const halfMigrated = Object.assign(new Error('msg'), {
            code: 'FORBIDDEN',
        });

        expect(isDomainError(halfMigrated)).toBe(false);
    });
});
