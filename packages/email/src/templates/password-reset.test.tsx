import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@react-email/components';
import { PasswordResetEmail, passwordResetSubject } from './password-reset';

describe('PasswordResetEmail', () => {
    const resetUrl = 'https://test.example/reset-password?token=abc123token';

    let html: string;
    beforeAll(async () => {
        html = await render(
            <PasswordResetEmail
                resetUrl={resetUrl}
                expiresAt={new Date('2026-08-01T12:00:00Z')}
            />
        );
    });

    it('renders the reset link on the button and as fallback text', () => {
        // Button href + plain-text fallback both carry the URL
        expect(html).toContain(resetUrl);
    });

    it('tells a recipient who did not request it that they can ignore it', () => {
        expect(html).toContain('ignore');
    });

    it('renders the expiry in UTC', () => {
        expect(html).toContain('This link expires on');
        expect(html).toContain('August 1, 2026 at 12:00 PM UTC');
    });

    it('renders to a full HTML document', () => {
        expect(html).toContain('<!DOCTYPE html');
    });

    it('builds a subject line naming the reset', () => {
        expect(passwordResetSubject()).toBe('Reset your Nexus password');
    });
});
