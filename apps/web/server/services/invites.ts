import { randomBytes } from 'node:crypto';
import type { DB } from '@nexus/db';
import { createInviteRepo, type Invite } from '@nexus/db/repo/invites';
import { env } from '@/lib/env';
import { InvalidStateError, NotFoundError } from '@/server/errors';
import { logger } from '@/server/lib/logger';

const log = logger.child({ service: 'invites' });

export interface CreateInviteInput {
    createdBy: string;
    email?: string;
    storageLimit?: number;
    expiresAt?: Date;
}

/** 32 bytes → 43-char base64url; ≥128 bits of entropy per the token decision in #239. */
function generateInviteToken(): string {
    return randomBytes(32).toString('base64url');
}

async function createInvite(
    db: DB,
    input: CreateInviteInput
): Promise<{ invite: Invite; url: string }> {
    const repo = createInviteRepo(db);
    const invite = await repo.insert({
        id: crypto.randomUUID(),
        token: generateInviteToken(),
        email: input.email ?? null,
        storageLimit: input.storageLimit ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy,
    });

    log.info(
        {
            inviteId: invite.id,
            createdBy: invite.createdBy,
            email: invite.email,
            storageLimit: invite.storageLimit,
            expiresAt: invite.expiresAt,
        },
        'Invite created'
    );

    return { invite, url: `${env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}` };
}

async function revokeInvite(db: DB, id: string): Promise<Invite> {
    const repo = createInviteRepo(db);
    const revoked = await repo.revoke(id);
    if (revoked) {
        log.info({ inviteId: id }, 'Invite revoked');
        return revoked;
    }

    // The conditional update matched nothing — distinguish missing from
    // already-redeemed/revoked for a useful admin-facing error.
    const existing = await repo.findById(id);
    if (!existing) throw new NotFoundError('Invite', id);
    throw new InvalidStateError(
        `Only pending invites can be revoked (invite is ${existing.status})`
    );
}

export const inviteService = {
    createInvite,
    revokeInvite,
} as const;
