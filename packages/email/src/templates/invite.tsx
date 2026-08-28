import { Button, Heading, Section, Text } from '@react-email/components';
import { EmailLayout } from './_layout';
import { Callout, CalloutStrong } from './components/callout';
import { ClockIcon } from './components/icons';
import { LinkFallback } from './components/link-fallback';
import { formatEmailDateTime } from './format';
import { button, buttonSection, heading, intro, introStrong } from './styles';
import { colors } from './theme';

export interface InviteEmailProps {
    inviteUrl: string;
    /** Invites may be open-ended; the expiry callout renders only when set. */
    expiresAt: Date | null;
}

/**
 * Subject line for this email. Co-located with the component so the whole
 * message — subject, preview, body — reads and tests as one unit, and a copy
 * change can't drift between the inbox line and the body.
 */
export function inviteSubject(): string {
    return "You've been given free access to Nexus";
}

export function InviteEmail({ inviteUrl, expiresAt }: InviteEmailProps) {
    return (
        <EmailLayout
            preview="Accept your invite to start archiving your files"
            footer={<LinkFallback url={inviteUrl} />}
        >
            <Heading style={heading}>You&apos;ve been invited</Heading>
            <Text style={intro}>
                You&apos;ve been given free access to{' '}
                <strong style={introStrong}>Nexus</strong> — deep storage for
                the files you can&apos;t afford to lose. Accept your invite to
                create an account and start archiving.
            </Text>

            <Section style={buttonSection}>
                <Button style={button} href={inviteUrl}>
                    Accept invite
                </Button>
            </Section>

            {expiresAt && (
                <Callout icon={<ClockIcon size={16} color={colors.primary} />}>
                    This invite expires on{' '}
                    <CalloutStrong>
                        {formatEmailDateTime(expiresAt)}
                    </CalloutStrong>
                    . Accept it before then to claim your access.
                </Callout>
            )}
        </EmailLayout>
    );
}
