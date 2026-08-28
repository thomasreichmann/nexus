import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@react-email/components';
import { InviteEmail, inviteSubject } from './invite';

describe('InviteEmail', () => {
    const inviteUrl = 'https://test.example/invite/abc123token';

    let html: string;
    beforeAll(async () => {
        html = await render(
            <InviteEmail inviteUrl={inviteUrl} expiresAt={null} />
        );
    });

    it('renders the invite link on the button and as fallback text', () => {
        // Button href + plain-text fallback both carry the URL
        expect(html).toContain(inviteUrl);
    });

    it('frames the invite as free access to Nexus', () => {
        expect(html).toContain('free access to');
    });

    it('omits the expiry callout when the invite has no expiry', () => {
        expect(html).not.toContain('This invite expires on');
    });

    it('renders the expiry in UTC when the invite is time-boxed', async () => {
        const withExpiry = await render(
            <InviteEmail
                inviteUrl={inviteUrl}
                expiresAt={new Date('2026-08-01T12:00:00Z')}
            />
        );
        expect(withExpiry).toContain('This invite expires on');
        expect(withExpiry).toContain('August 1, 2026 at 12:00 PM UTC');
    });

    it('renders to a full HTML document', () => {
        expect(html).toContain('<!DOCTYPE html');
    });

    it('builds a subject line naming the free access', () => {
        expect(inviteSubject()).toBe("You've been given free access to Nexus");
    });
});
