import type { ReactNode } from 'react';

interface FormFeedbackProps {
    children: ReactNode;
}

/**
 * Inline submission failure. `role="alert"` interrupts a screen reader, which
 * is what a rejected submit warrants — e2e locators filter on the text because
 * a production build also renders Next's empty route-announcer alert.
 */
export function FormError({ children }: FormFeedbackProps) {
    return (
        <div
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
            {children}
        </div>
    );
}

/**
 * The quieter counterpart: a submit that succeeded and left the user on the
 * page. `role="status"` announces it without interrupting.
 */
export function FormStatus({ children }: FormFeedbackProps) {
    return (
        <div
            role="status"
            className="rounded-md bg-muted p-4 text-sm text-muted-foreground"
        >
            {children}
        </div>
    );
}
