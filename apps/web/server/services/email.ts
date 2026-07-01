import { createElement } from 'react';
import type { DB } from '@nexus/db';
import { createUserRepo } from '@nexus/db/repo/users';
import { NotFoundError } from '@/server/errors';
import { email } from '@/lib/email';

export interface SendRetrievalReadyEmailOptions {
    userId: string;
    fileName: string;
    downloadUrl: string;
    expiresAt: Date;
}

async function sendRetrievalReadyEmail(
    db: DB,
    opts: SendRetrievalReadyEmailOptions
): Promise<void> {
    const userRepo = createUserRepo(db);

    const user = await userRepo.findById(opts.userId);
    if (!user) {
        throw new NotFoundError('User', opts.userId);
    }

    await email.send({
        to: user.email,
        subject: `Your file "${opts.fileName}" is ready to download`,
        react: createElement(email.templates.RetrievalReadyEmail, {
            fileName: opts.fileName,
            downloadUrl: opts.downloadUrl,
            expiresAt: opts.expiresAt,
        }),
    });
}

export const emailService = {
    sendRetrievalReadyEmail,
} as const;
