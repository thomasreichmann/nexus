import { createElement } from 'react';
import type { DB } from '@nexus/db';
import { createUserRepo } from '@nexus/db/repo/users';
import { email, type RetrievalReadyEmailProps } from '@/lib/email';
import { logger } from '@/server/lib/logger';

const log = logger.child({ service: 'email' });

export interface SendRetrievalReadyEmailOptions extends RetrievalReadyEmailProps {
    userId: string;
}

// Notification failures shouldn't fail the work that triggered them (e.g. a
// completed S3 restore) — mirrors the warn-and-skip contract in
// s3-restore.ts's resolveRetrieval.
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

export const emailService = {
    sendRetrievalReadyEmail,
} as const;
