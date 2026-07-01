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
 * await email.send({
 *   to: 'user@example.com',
 *   subject: 'Your file is ready',
 *   react: createElement(email.templates.RetrievalReadyEmail, {
 *     fileName: 'photo.jpg',
 *     downloadUrl: 'https://...',
 *     expiresAt: new Date(),
 *   }),
 * });
 * ```
 */
export const email = {
    send,
    templates,
} as const;

export type { SendEmailOptions } from './send';
export type { RetrievalReadyEmailProps } from './templates';
