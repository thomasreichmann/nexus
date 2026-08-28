import { send } from './send';
import * as templates from './templates';

/**
 * Transactional email operations (Resend + React Email).
 *
 * A package rather than a folder in apps/web because the worker Lambda has to
 * send the same messages and cannot import from the app (the @nexus/db
 * precedent, #364).
 *
 * @example
 * ```typescript
 * import { email } from '@nexus/email';
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

export type {
    InviteEmailProps,
    PasswordResetEmailProps,
    RetrievalReadyEmailProps,
} from './templates';
