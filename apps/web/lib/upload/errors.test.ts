import { describe, expect, it } from 'vitest';
import { UploadHttpError, UploadNetworkError } from '@/lib/http/xhr';
import { isExpiredUrlError, isNetworkError, isAbortError } from './errors';

describe('isExpiredUrlError', () => {
    it('is true for a 403', () => {
        expect(isExpiredUrlError(new UploadHttpError(403))).toBe(true);
    });

    it('is false for other statuses', () => {
        expect(isExpiredUrlError(new UploadHttpError(500))).toBe(false);
    });

    it('is false for non-http errors', () => {
        expect(isExpiredUrlError(new UploadNetworkError())).toBe(false);
        expect(isExpiredUrlError(new Error('x'))).toBe(false);
    });
});

describe('isNetworkError', () => {
    it('is true for a network error', () => {
        expect(isNetworkError(new UploadNetworkError())).toBe(true);
    });

    it('is false for http errors', () => {
        expect(isNetworkError(new UploadHttpError(403))).toBe(false);
    });
});

describe('isAbortError', () => {
    it('is true for an AbortError DOMException', () => {
        expect(
            isAbortError(new DOMException('Upload aborted', 'AbortError'))
        ).toBe(true);
    });

    it('is false for other errors', () => {
        expect(isAbortError(new Error('nope'))).toBe(false);
    });
});
