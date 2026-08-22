import { createElement } from 'react';
import { createUserRepo } from '@nexus/db/repo/users';
import { alerts } from '@/lib/alerts';
import {
    email,
    type InviteEmailProps,
    type PasswordResetEmailProps,
    type RetrievalReadyEmailProps,
} from '@/lib/email';
import { toErrorMessage } from '@/lib/errors';
import { logger } from '@/server/lib/logger';
import type { DB } from '@nexus/db';

const log = logger.child({ service: 'email' });

export interface SendRetrievalReadyEmailOptions extends RetrievalReadyEmailProps {
    userId: string;
}

// Notification failures shouldn't fail the work that triggered them (e.g. a
// completed S3 restore) — mirrors the warn-and-skip contract in
// the retrieval poll.
async function sendRetrievalReadyEmail(
    db: DB,
    opts: SendRetrievalReadyEmailOptions
): Promise<void> {
    const userRepo = createUserRepo(db);

    const user = await userRepo.findById(opts.userId);
    if (!user) {
        log.warn(
            { userId: opts.userId },
            'Skipping retrieval-ready email for unknown user'
        );
        return;
    }

    try {
        await email.send({
            to: user.email,
            subject: email.templates.retrievalReadySubject(opts),
            react: createElement(email.templates.RetrievalReadyEmail, opts),
        });
    } catch (err) {
        log.warn(
            { userId: opts.userId, err },
            'Failed to send retrieval-ready email'
        );
    }
}

export interface SendInviteEmailOptions extends InviteEmailProps {
    /** Recipient — the invite's bound email; unbound invites are never sent. */
    to: string;
}

// No db lookup here: the recipient comes straight off the invite row. Same
// warn-and-swallow contract as above — delivery must not fail invite creation.
async function sendInviteEmail(opts: SendInviteEmailOptions): Promise<void> {
    const { to, ...props } = opts;

    try {
        await email.send({
            to,
            subject: email.templates.inviteSubject(),
            react: createElement(email.templates.InviteEmail, props),
        });
    } catch (err) {
        log.warn({ to, err }, 'Failed to send invite email');
    }
}

export interface SendPasswordResetEmailOptions extends PasswordResetEmailProps {
    /** Recipient — the account's own address, from better-auth's reset request. */
    to: string;
}

// Deliberately NOT warn-and-swallow like the two above. A reset email is the
// only way back into an account whose password is lost, so a swallowed failure
// shows the user "check your email" for a message that will never arrive.
// Alert the operator, then rethrow: better-auth awaits this callback, so the
// throw surfaces as a failed /request-password-reset the user can see and retry.
async function sendPasswordResetEmail(
    opts: SendPasswordResetEmailOptions
): Promise<void> {
    const { to, ...props } = opts;

    try {
        await email.send({
            to,
            subject: email.templates.passwordResetSubject(),
            react: createElement(email.templates.PasswordResetEmail, props),
        });
    } catch (err) {
        log.error({ to, err }, 'Failed to send password reset email');
        await alerts.send({
            severity: 'critical',
            title: 'Password reset email failed to send',
            message:
                'The reset link never reached the user — they stay locked out until this is fixed.',
            context: { source: 'auth', to, error: toErrorMessage(err) },
        });
        throw err;
    }
}

export const emailService = {
    sendInviteEmail,
    sendPasswordResetEmail,
    sendRetrievalReadyEmail,
} as const;
