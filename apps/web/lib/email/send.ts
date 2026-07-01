import type { ReactElement } from 'react';
import { resendClient, fromEmail } from './client';

export interface SendEmailOptions {
    to: string;
    subject: string;
    react: ReactElement;
}

/**
 * Sends a transactional email via Resend, rendering the given React Email
 * element to HTML. Throws if Resend reports a delivery error so callers can
 * decide how to handle it (the Resend SDK returns errors instead of throwing).
 */
export async function send(options: SendEmailOptions): Promise<void> {
    const { error } = await resendClient.emails.send({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        react: options.react,
    });

    if (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}
