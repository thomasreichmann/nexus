import Link from 'next/link';
import { Sparkles, MailQuestion } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AuthNotice } from '@/components/auth/auth-notice';
import { AuthPageShell } from '@/components/auth/auth-page-shell';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { db } from '@/server/db';
import {
    inviteService,
    type InviteRedemption,
} from '@/server/services/invites';

// Invite state must be fresh on every request — a redeemed, revoked, or
// expired link has to stop working immediately, so opt out of route caching.
export const dynamic = 'force-dynamic';

interface InvitePageProps {
    params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
    const { token } = await params;
    const redemption = await inviteService.getInviteRedemption(db, token);

    if (redemption.status !== 'valid') {
        return <InviteUnavailable status={redemption.status} />;
    }

    return (
        <AuthPageShell
            badge={
                <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
                    <Sparkles className="size-3.5" />
                    Sponsored access
                </span>
            }
            title="You're invited to Nexus"
            subtitle="Create your account and start archiving — storage is on us."
            footer={<SignInPrompt />}
        >
            <SignUpForm
                inviteToken={token}
                lockedEmail={redemption.email ?? undefined}
            />
        </AuthPageShell>
    );
}

const UNAVAILABLE_COPY: Record<
    Exclude<InviteRedemption['status'], 'valid'>,
    { title: string; body: string }
> = {
    invalid: {
        title: 'This invite link isn’t valid',
        body: 'Check that the link matches the one you were sent — it may have been truncated. If it still doesn’t work, ask the person who invited you for a fresh link.',
    },
    expired: {
        title: 'This invite has expired',
        body: 'Invite links are only valid for a limited time. Ask the person who invited you to send a new one.',
    },
    redeemed: {
        title: 'This invite has already been used',
        body: 'Each invite works exactly once. If you redeemed it yourself, just sign in to your account.',
    },
    revoked: {
        title: 'This invite is no longer active',
        body: 'The invite was withdrawn. If you think that’s a mistake, reach out to the person who invited you.',
    },
};

function InviteUnavailable({
    status,
}: {
    status: Exclude<InviteRedemption['status'], 'valid'>;
}) {
    const copy = UNAVAILABLE_COPY[status];
    return (
        <AuthNotice
            icon={<MailQuestion className="size-6 text-muted-foreground" />}
            title={copy.title}
            body={copy.body}
        >
            <SignInPrompt />
        </AuthNotice>
    );
}

function SignInPrompt({ className }: { className?: string }) {
    return (
        <p
            className={cn(
                'text-center text-sm text-muted-foreground',
                className
            )}
        >
            Already have an account?{' '}
            <Link
                href="/sign-in"
                className="font-medium text-primary hover:underline"
            >
                Sign in
            </Link>
        </p>
    );
}
