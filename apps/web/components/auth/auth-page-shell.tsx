import type { ReactNode } from 'react';

interface AuthPageShellProps {
    title: string;
    subtitle?: ReactNode;
    /** Sits above the title — e.g. the invite page's "Sponsored access" pill. */
    badge?: ReactNode;
    /**
     * Sits below the form in muted centered text — e.g. "Already have an
     * account? Sign in". Pass only the content; the shell owns the spacing.
     */
    footer?: ReactNode;
    children: ReactNode;
}

/**
 * The frame every `(auth)` page shares: centered column, heading block, form,
 * footer prompt. `min-w-0` matters — the column is a flex child of the auth
 * layout, so without it a long unbreakable string (an echoed email address)
 * would widen the page past a phone viewport instead of wrapping (#311).
 */
export function AuthPageShell({
    title,
    subtitle,
    badge,
    footer,
    children,
}: AuthPageShellProps) {
    return (
        <div className="mx-auto w-full min-w-0 max-w-md">
            <div className="mb-8 text-center">
                {badge}
                <h1 className="mb-2 text-2xl font-bold">{title}</h1>
                {subtitle && (
                    <p className="text-muted-foreground">{subtitle}</p>
                )}
            </div>
            {children}
            {footer && (
                <div className="mt-6 text-center text-sm text-muted-foreground">
                    {footer}
                </div>
            )}
        </div>
    );
}
