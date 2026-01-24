import { describe, expect, it } from 'vitest';
import {
    DomainError,
    NotFoundError,
    ForbiddenError,
    InvalidStateError,
    QuotaExceededError,
    isDomainError,
} from './errors';

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
    });
});

describe('NotFoundError', () => {
    it('maps to NOT_FOUND tRPC code', () => {
        const error = new NotFoundError('File');

        expect(error.trpcCode).toBe('NOT_FOUND');
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
    it('maps to FORBIDDEN tRPC code', () => {
        const error = new ForbiddenError();

        expect(error.trpcCode).toBe('FORBIDDEN');
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
    it('maps to BAD_REQUEST tRPC code', () => {
        const error = new InvalidStateError('Operation not allowed');

        expect(error.trpcCode).toBe('BAD_REQUEST');
    });

    it('uses provided message', () => {
        const error = new InvalidStateError('Retrieval already in progress');

        expect(error.message).toBe('Retrieval already in progress');
    });
});

describe('QuotaExceededError', () => {
    it('maps to PRECONDITION_FAILED tRPC code', () => {
        const error = new QuotaExceededError();

        expect(error.trpcCode).toBe('PRECONDITION_FAILED');
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

describe('isDomainError', () => {
    it('returns true for DomainError subclasses', () => {
        expect(isDomainError(new NotFoundError('File'))).toBe(true);
        expect(isDomainError(new ForbiddenError())).toBe(true);
        expect(isDomainError(new InvalidStateError('msg'))).toBe(true);
        expect(isDomainError(new QuotaExceededError())).toBe(true);
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
});
