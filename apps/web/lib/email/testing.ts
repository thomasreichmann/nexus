/**
 * Testing utilities for mocking transactional email
 *
 * Provides a deterministic mock for `@/lib/email`'s `email` export so unit
 * tests can assert on send calls without hitting Resend or needing an API key.
 *
 * @example
 * ```typescript
 * import { vi } from 'vitest';
 * import { mockEmail } from '@/lib/email/testing';
 *
 * vi.mock('@/lib/email', () => ({ email: mockEmail }));
 *
 * // mockEmail.send is a vi.fn() — assert it was called with the right args.
 * ```
 */
import { vi, type Mock } from 'vitest';
import * as templates from './templates';

export interface MockEmail {
    send: Mock;
    templates: typeof templates;
}

export function createEmailMock(): MockEmail {
    return {
        send: vi.fn(async (): Promise<void> => {}),
        templates,
    };
}

export const mockEmail: MockEmail = createEmailMock();
