import { Button, Heading, Section, Text } from '@react-email/components';
import { EmailLayout } from './_layout';
import { Callout, CalloutStrong } from './components/callout';
import { ClockIcon } from './components/icons';
import { LinkFallback } from './components/link-fallback';
import { formatEmailDateTime } from './format';
import { button, buttonSection, heading, intro, introStrong } from './styles';
import { colors } from './theme';

export interface PasswordResetEmailProps {
    resetUrl: string;
    /** When the link stops working — reset tokens are always time-boxed. */
    expiresAt: Date;
}

/** Subject line — co-located with the component; see `templates/index.ts`. */
export function passwordResetSubject(): string {
    return 'Reset your Nexus password';
}

export function PasswordResetEmail({
    resetUrl,
    expiresAt,
}: PasswordResetEmailProps) {
    return (
        <EmailLayout
            preview="Choose a new password for your Nexus account"
            footer={<LinkFallback url={resetUrl} />}
        >
            <Heading style={heading}>Reset your password</Heading>
            <Text style={intro}>
                Someone asked to reset the password for your{' '}
                <strong style={introStrong}>Nexus</strong> account. Choose a new
                one to get back to your files. If this wasn&apos;t you, ignore
                this email — your password stays as it is.
            </Text>

            <Section style={buttonSection}>
                <Button style={button} href={resetUrl}>
                    Choose a new password
                </Button>
            </Section>

            <Callout icon={<ClockIcon size={16} color={colors.primary} />}>
                This link expires on{' '}
                <CalloutStrong>{formatEmailDateTime(expiresAt)}</CalloutStrong>.
                After that, request a new one from the sign-in page.
            </Callout>
        </EmailLayout>
    );
}
