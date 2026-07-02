import Link from 'next/link';
import { Shield, DollarSign, Archive } from 'lucide-react';
import { InviteSignUpForm } from '@/components/auth/invite-sign-up-form';
import { db } from '@/server/db';
import {
    inviteService,
    type InviteInvalidReason,
} from '@/server/services/invites';

interface InvitePageProps {
    params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
    const { token } = await params;
    const invite = await inviteService.getRedeemableInvite(db, token);

    if (!invite.valid) {
        return <InviteUnavailable reason={invite.reason} />;
    }

    return (
        <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Accept your invite</h1>
                <p className="text-muted-foreground">
                    Create your account and start archiving
                </p>
            </div>
            <InviteSignUpForm token={token} boundEmail={invite.email} />
            <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                    href="/sign-in"
                    className="font-medium text-primary hover:underline"
                >
                    Sign in
                </Link>
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    <DollarSign className="size-3.5 text-primary" />
                    <span>Sponsored access</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Shield className="size-3.5 text-primary" />
                    <span>Encrypted</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Archive className="size-3.5 text-primary" />
                    <span>No credit card</span>
                </div>
            </div>
        </div>
    );
}

const INVALID_MESSAGES: Record<InviteInvalidReason, string> = {
    not_found:
        "This invite link isn't valid. Check that you copied the whole link.",
    redeemed: 'This invite has already been used to create an account.',
    revoked: 'This invite is no longer active. Ask your contact for a new one.',
    expired: 'This invite has expired. Ask your contact for a new one.',
};

function InviteUnavailable({ reason }: { reason: InviteInvalidReason }) {
    return (
        <div className="mx-auto w-full max-w-md text-center">
            <h1 className="mb-2 text-2xl font-bold">Invite unavailable</h1>
            <p className="text-muted-foreground">{INVALID_MESSAGES[reason]}</p>
            <p className="mt-6 text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                    href="/sign-in"
                    className="font-medium text-primary hover:underline"
                >
                    Sign in
                </Link>
            </p>
        </div>
    );
}
