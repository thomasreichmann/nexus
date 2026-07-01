import type { CSSProperties, ReactNode } from 'react';
import {
    Body,
    Column,
    Container,
    Head,
    Hr,
    Html,
    Preview,
    Row,
    Section,
    Text,
} from '@react-email/components';
import { ArchiveIcon } from './components/icons';
import { colors, fontFamily, radii, spacing } from './theme';

export interface EmailLayoutProps {
    /** Inbox preview line (the grey text after the subject). */
    preview: string;
    /** The template's main content. */
    children: ReactNode;
    /**
     * Optional block rendered below the divider, before the brand sign-off —
     * e.g. a "button not working? paste this link" fallback. Templates without
     * a primary action can omit it.
     */
    footer?: ReactNode;
}

/**
 * Shared chrome for every transactional email: document shell, brand band, and
 * the sign-off footer. Templates render only their body as `children` so the
 * frame stays identical across the whole email library — change it once here.
 */
export function EmailLayout({ preview, children, footer }: EmailLayoutProps) {
    return (
        <Html>
            <Head />
            <Preview>{preview}</Preview>
            <Body style={body}>
                <Container style={container}>
                    {/* Brand band — the icon degrades to the wordmark if a
                        client strips inline SVG (e.g. Gmail webmail). */}
                    <Section style={band}>
                        <Row>
                            <Column style={brandMarkCell}>
                                <ArchiveIcon
                                    size={20}
                                    color={colors.onPrimary}
                                />
                            </Column>
                            <Column>
                                <Text style={wordmark}>Nexus</Text>
                            </Column>
                        </Row>
                    </Section>

                    <Section style={content}>
                        {children}

                        <Hr style={hr} />

                        {footer}

                        <Text style={footerBrand}>
                            Nexus · deep storage for the files you can&apos;t
                            afford to lose
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}

const body: CSSProperties = {
    backgroundColor: colors.canvas,
    margin: 0,
    padding: '32px 0',
    fontFamily,
};

const container: CSSProperties = {
    backgroundColor: colors.surface,
    margin: '0 auto',
    maxWidth: '480px',
    borderRadius: radii.lg,
    border: `1px solid ${colors.border}`,
    overflow: 'hidden',
};

const band: CSSProperties = {
    backgroundColor: colors.primary,
    padding: `18px ${spacing.gutter}`,
};

const brandMarkCell: CSSProperties = {
    width: '30px',
    verticalAlign: 'middle',
};

const wordmark: CSSProperties = {
    margin: 0,
    fontSize: '17px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: colors.onPrimary,
    lineHeight: '20px',
};

const content: CSSProperties = {
    padding: spacing.gutter,
};

const hr: CSSProperties = {
    borderColor: colors.border,
    margin: '24px 0',
};

const footerBrand: CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: colors.faint,
    margin: 0,
};
