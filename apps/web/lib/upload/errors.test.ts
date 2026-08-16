import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = await vi.hoisted(async () => {
    const { createMockSentry } = await import('@/lib/sentry/testing');
    const { createMockPostHogClient } = await import('@/lib/posthog/testing');
    return { sentry: createMockSentry(), posthog: createMockPostHogClient() };
});

vi.mock('@sentry/nextjs', () => hoisted.sentry);
vi.mock('@/lib/posthog/client', () => hoisted.posthog);

import { UploadHttpError, UploadNetworkError } from '@/lib/http/xhr';
import { PostHogEvent } from '@/lib/posthog/events';
import { makeClientError } from '@/lib/trpc/test-fixtures';
import {
    isExpiredUrlError,
    isNetworkError,
    isAbortError,
    isQuotaExceededError,
    reportUploadFailure,
} from './errors';

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

describe('isQuotaExceededError', () => {
    it('is true for a QUOTA_EXCEEDED domain error', () => {
        expect(
            isQuotaExceededError(
                makeClientError({
                    code: 'PRECONDITION_FAILED',
                    domainCode: 'QUOTA_EXCEEDED',
                })
            )
        ).toBe(true);
    });

    it('is false for other domain errors', () => {
        expect(
            isQuotaExceededError(
                makeClientError({
                    code: 'FORBIDDEN',
                    domainCode: 'TRIAL_EXPIRED',
                })
            )
        ).toBe(false);
    });

    it('is false for transport failures', () => {
        expect(isQuotaExceededError(new UploadHttpError(403))).toBe(false);
        expect(isQuotaExceededError(new Error('x'))).toBe(false);
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

describe('reportUploadFailure', () => {
    beforeEach(() => {
        hoisted.sentry.captureException.mockClear();
        hoisted.posthog.captureEvent.mockClear();
    });

    const upload = {
        id: 'row_1',
        name: 'photo.raw',
        size: 1024,
        fileId: 'f_1',
        batchId: 'b_1',
    };

    it('captures S3/transport failures with upload context', () => {
        const error = new UploadHttpError(500);
        reportUploadFailure(error, 'multipart', upload);

        expect(hoisted.sentry.captureException).toHaveBeenCalledOnce();
        const [captured, options] =
            hoisted.sentry.captureException.mock.calls[0]!;
        expect(captured).toBe(error);
        expect(options.tags).toEqual({
            feature: 'upload',
            engine: 'multipart',
        });
        expect(options.contexts.upload).toEqual({
            fileId: 'f_1',
            fileName: 'photo.raw',
            sizeBytes: 1024,
            batchId: 'b_1',
        });
    });

    it('skips tRPC failures — the MutationCache capture owns those', () => {
        const error = makeClientError({
            code: 'PRECONDITION_FAILED',
            domainCode: 'QUOTA_EXCEEDED',
        });
        reportUploadFailure(error, 'single', upload);

        expect(hoisted.sentry.captureException).not.toHaveBeenCalled();
    });

    // The two sinks disagree on scope deliberately — see the docblock on
    // reportUploadFailure. These pin that difference down.
    it('reports transport failures to PostHog as a lost upload', () => {
        reportUploadFailure(new UploadHttpError(500), 'multipart', upload);

        expect(hoisted.posthog.captureEvent).toHaveBeenCalledOnce();
        expect(hoisted.posthog.captureEvent).toHaveBeenCalledWith(
            PostHogEvent.UploadFailed,
            {
                engine: 'multipart',
                fileId: 'f_1',
                sizeBytes: 1024,
                batchId: 'b_1',
                clientUploadId: 'row_1',
                isServerRejection: false,
            }
        );
    });

    it('reports tRPC failures to PostHog too, flagged as server rejections', () => {
        const error = makeClientError({
            code: 'PRECONDITION_FAILED',
            domainCode: 'QUOTA_EXCEEDED',
        });
        reportUploadFailure(error, 'single', upload);

        expect(hoisted.posthog.captureEvent).toHaveBeenCalledOnce();
        expect(hoisted.posthog.captureEvent).toHaveBeenCalledWith(
            PostHogEvent.UploadFailed,
            expect.objectContaining({
                engine: 'single',
                isServerRejection: true,
            })
        );
    });
});
