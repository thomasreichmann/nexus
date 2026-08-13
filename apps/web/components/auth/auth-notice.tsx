import type { ReactNode } from 'react';

interface AuthNoticeProps {
    /** Lucide icon element, rendered inside the muted bubble. */
    icon: ReactNode;
    title: string;
    body: string;
    /** Optional way forward — a sign-in prompt, a link to start over. */
    children?: ReactNode;
}

/**
 * Dead-end state for a link that can't be used: a bad invite, a reset link with
 * no token. Explains what happened and offers the next step, instead of
 * rendering a form that could only fail.
 */
export function AuthNotice({ icon, title, body, children }: AuthNoticeProps) {
    return (
        <div className="mx-auto w-full min-w-0 max-w-md text-center">
            <div className="mb-6 inline-flex size-12 items-center justify-center rounded-full bg-muted">
                {icon}
            </div>
            <h1 className="mb-2 text-2xl font-bold">{title}</h1>
            <p className="mb-8 text-muted-foreground">{body}</p>
            {children}
        </div>
    );
}
