import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { AuthNotice } from '@/components/auth/auth-notice';
import { AuthPageShell } from '@/components/auth/auth-page-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { RESET_PASSWORD_TOKEN_TTL_LABEL } from '@/lib/auth/constants';

interface ResetPasswordPageProps {
    searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({
    searchParams,
}: ResetPasswordPageProps) {
    const { token } = await searchParams;

    // A truncated or hand-typed link never reaches the API — say so here
    // instead of rendering a form that can only fail.
    if (!token) {
        return (
            <AuthNotice
                icon={<KeyRound className="size-6 text-muted-foreground" />}
                title="This reset link isn't usable"
                body={`Check that the link matches the one you were emailed — it may have been truncated. Reset links also expire ${RESET_PASSWORD_TOKEN_TTL_LABEL} after they are sent.`}
            >
                <Link
                    href="/forgot-password"
                    className="font-medium text-primary hover:underline"
                >
                    Request a new link
                </Link>
            </AuthNotice>
        );
    }

    return (
        <AuthPageShell
            title="Choose a new password"
            subtitle="You'll use it the next time you sign in"
        >
            <ResetPasswordForm token={token} />
        </AuthPageShell>
    );
}
