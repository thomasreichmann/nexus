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

    it('updates client log context with userId and page on mount', () => {
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
        const event = new Event('unhandledrejection') as PromiseRejectionEvent;
        Object.defineProperty(event, 'reason', { value: err });
        Object.defineProperty(event, 'promise', {
            value: Promise.reject(err).catch(() => {}),
        });
        window.dispatchEvent(event);

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({ err, reason: err });
        expect(msg).toBe('rejected');
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
