import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    logErrorMock: vi.fn(),
    setClientLogContextMock: vi.fn(),
    useSessionMock: vi.fn(),
    usePathnameMock: vi.fn(),
}));

vi.mock('@/lib/logger/client', () => ({
    log: { error: hoisted.logErrorMock },
    setClientLogContext: hoisted.setClientLogContextMock,
}));
vi.mock('@/lib/auth/client', () => ({
    useSession: () => hoisted.useSessionMock(),
}));
vi.mock('next/navigation', () => ({
    usePathname: () => hoisted.usePathnameMock(),
}));

import { ClientErrorReporter } from './ClientErrorReporter';

describe('ClientErrorReporter', () => {
    beforeEach(() => {
        hoisted.logErrorMock.mockClear();
        hoisted.setClientLogContextMock.mockClear();
        hoisted.useSessionMock.mockReturnValue({ data: null });
        hoisted.usePathnameMock.mockReturnValue('/');
    });

    afterEach(() => {
        cleanup();
    });

    it('updates client log context with userId and page during render', () => {
        hoisted.useSessionMock.mockReturnValue({
            data: { user: { id: 'user-7' } },
        });
        hoisted.usePathnameMock.mockReturnValue('/dashboard/files');

        render(<ClientErrorReporter />);

        expect(hoisted.setClientLogContextMock).toHaveBeenCalledWith({
            userId: 'user-7',
            page: '/dashboard/files',
        });
    });

    it('re-fires setClientLogContext when session or pathname changes', () => {
        hoisted.useSessionMock.mockReturnValue({ data: null });
        hoisted.usePathnameMock.mockReturnValue('/');
        const { rerender } = render(<ClientErrorReporter />);

        hoisted.setClientLogContextMock.mockClear();
        hoisted.useSessionMock.mockReturnValue({
            data: { user: { id: 'user-9' } },
        });
        hoisted.usePathnameMock.mockReturnValue('/dashboard');
        rerender(<ClientErrorReporter />);

        expect(hoisted.setClientLogContextMock).toHaveBeenCalledWith({
            userId: 'user-9',
            page: '/dashboard',
        });
    });

    it('logs uncaught window errors', () => {
        render(<ClientErrorReporter />);

        const err = new Error('boom');
        window.dispatchEvent(
            new ErrorEvent('error', {
                message: 'boom',
                error: err,
                filename: 'app.js',
                lineno: 42,
                colno: 7,
            })
        );

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({
            err,
            source: 'app.js',
            line: 42,
            col: 7,
        });
        expect(msg).toBe('boom');
    });

    it('logs unhandled promise rejections with an Error reason', () => {
        render(<ClientErrorReporter />);

        const err = new Error('rejected');
        dispatchRejection(err);

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({ err });
        expect(meta.reason).toBeUndefined();
        expect(msg).toBe('rejected');
    });

    it('logs unhandled promise rejections with a string reason', () => {
        render(<ClientErrorReporter />);

        dispatchRejection('quota exceeded');

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({ reason: 'quota exceeded' });
        expect(meta.err).toBeUndefined();
        expect(msg).toBe('quota exceeded');
    });

    it('logs unhandled promise rejections with a non-Error object reason', () => {
        render(<ClientErrorReporter />);

        const reason = { code: 'INVALID', detail: 'nope' };
        dispatchRejection(reason);

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({ reason });
        expect(meta.err).toBeUndefined();
        expect(msg).toBe('unhandled promise rejection');
    });

    it('removes listeners on unmount', () => {
        const { unmount } = render(<ClientErrorReporter />);
        unmount();

        window.dispatchEvent(
            new ErrorEvent('error', { message: 'after unmount' })
        );

        expect(hoisted.logErrorMock).not.toHaveBeenCalled();
    });
});

function dispatchRejection(reason: unknown): void {
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: reason });
    Object.defineProperty(event, 'promise', {
        value: Promise.reject(reason).catch(() => {}),
    });
    window.dispatchEvent(event);
}
