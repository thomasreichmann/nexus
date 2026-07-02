import { randomBytes } from 'node:crypto';
import type { DB } from '@nexus/db';
import { createInviteRepo, type Invite } from '@nexus/db/repo/invites';
import { env } from '@/lib/env';
import { InvalidStateError, NotFoundError } from '@/server/errors';
import { logger } from '@/server/lib/logger';
import { emailService } from '@/server/services/email';

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

    const url = `${env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`;

    // Email-bound invites are delivered directly; unbound ones have no
    // recipient and stay manual. Delivery failure must never block creation —
    // the row is persisted and the link is still returned. (The email service
    // swallows send errors itself; this catch is a backstop so createInvite
    // holds that guarantee locally.)
    if (invite.email) {
        try {
            await emailService.sendInviteEmail({
                to: invite.email,
                inviteUrl: url,
                expiresAt: invite.expiresAt,
            });
        } catch (err) {
            log.error(
                { err, inviteId: invite.id },
                'Invite email failed after invite creation'
            );
        }
    }

    return { invite, url };
}

/**
 * Everything the public redemption page needs to render: whether the link is
 * usable and, for email-bound invites, the address to lock the signup form
 * to. Non-valid states are distinguished so the page can explain what
 * happened. Read-only — claiming stays in the signup create-hook, and the
 * provisioning path re-checks all of this authoritatively.
 */
export type InviteRedemption =
    | { status: 'valid'; email: string | null }
    | { status: 'invalid' | 'expired' | 'redeemed' | 'revoked' };

async function getInviteRedemption(
    db: DB,
    token: string
): Promise<InviteRedemption> {
    const invite = await createInviteRepo(db).findByToken(token);
    if (!invite) return { status: 'invalid' };
    if (invite.status !== 'pending') return { status: invite.status };
    if (invite.expiresAt && invite.expiresAt <= new Date()) {
        return { status: 'expired' };
    }
    return { status: 'valid', email: invite.email };
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
    getInviteRedemption,
    revokeInvite,
} as const;
