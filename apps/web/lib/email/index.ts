import { send } from './send';
import * as templates from './templates';

/**
 * Transactional email operations (Resend + React Email).
 *
 * @example
 * ```typescript
 * import { email } from '@/lib/email';
 * import { createElement } from 'react';
 *
 * const props = {
 *   fileName: 'photo.jpg',
 *   downloadUrl: 'https://...',
 *   expiresAt: new Date(),
 * };
 * await email.send({
 *   to: 'user@example.com',
 *   subject: email.templates.retrievalReadySubject(props),
 *   react: createElement(email.templates.RetrievalReadyEmail, props),
 * });
 * ```
 */
export const email = {
    send,
    templates,
} as const;

export type { RetrievalReadyEmailProps } from './templates';
