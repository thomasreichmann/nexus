import type { CSSProperties } from 'react';
import {
    Button,
    Column,
    Heading,
    Row,
    Section,
    Text,
} from '@react-email/components';
import { EmailLayout } from './_layout';
import { ArchiveIcon, ClockIcon } from './components/icons';
import { formatEmailDateTime } from './format';
import { colors, radii, spacing } from './theme';

export interface RetrievalReadyEmailProps {
    fileName: string;
    downloadUrl: string;
    expiresAt: Date;
}

/**
 * Subject line for this email. Co-located with the component so the whole
 * message — subject, preview, body — reads and tests as one unit, and a copy
 * change can't drift between the inbox line and the body.
 */
export function retrievalReadySubject({
    fileName,
}: Pick<RetrievalReadyEmailProps, 'fileName'>): string {
    return `Your file "${fileName}" is ready to download`;
}

export function RetrievalReadyEmail({
    fileName,
    downloadUrl,
    expiresAt,
}: RetrievalReadyEmailProps) {
    // e.g. "July 8, 2026 at 3:45 PM UTC" — explicit zone since the reader's is unknown
    const formattedExpiry = formatEmailDateTime(expiresAt);

    return (
        <EmailLayout
            preview={`${fileName} is ready to download`}
            footer={
                <>
                    <Text style={footerLabel}>
                        Button not working? Paste this link into your browser:
                    </Text>
                    <Text style={footerLink}>{downloadUrl}</Text>
                </>
            }
        >
            <Heading style={heading}>Your file is ready</Heading>
            <Text style={intro}>
                <strong style={introStrong}>{fileName}</strong> has finished
                restoring from archive and is ready to download.
            </Text>

            {/* File card — mirrors how a file reads in the app. */}
            <Section style={fileCard}>
                <Row>
                    <Column style={fileIconCell}>
                        <div style={fileIconCircle}>
                            <ArchiveIcon size={20} color={colors.primary} />
                        </div>
                    </Column>
                    <Column style={fileMetaCell}>
                        <Text style={fileName_}>{fileName}</Text>
                        <Text style={fileSub}>Ready to download</Text>
                    </Column>
                </Row>
            </Section>

            <Section style={buttonSection}>
                <Button style={button} href={downloadUrl}>
                    Download file
                </Button>
            </Section>

            {/* Expiry callout — this link is time-boxed, so give it its own
                weight rather than burying it in prose. */}
            <Section style={callout}>
                <Row>
                    <Column style={calloutIconCell}>
                        <ClockIcon size={16} color={colors.primary} />
                    </Column>
                    <Column>
                        <Text style={calloutText}>
                            This link expires on{' '}
                            <strong style={calloutStrong}>
                                {formattedExpiry}
                            </strong>
                            . After that, request the file again from your
                            library.
                        </Text>
                    </Column>
                </Row>
            </Section>
        </EmailLayout>
    );
}

// --- Styles -----------------------------------------------------------------

const heading: CSSProperties = {
    fontSize: '22px',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: colors.ink,
    margin: '0 0 12px',
};

const intro: CSSProperties = {
    fontSize: '15px',
    lineHeight: '24px',
    color: colors.body,
    margin: `0 0 ${spacing.block}`,
};

const introStrong: CSSProperties = {
    color: colors.ink,
    fontWeight: 600,
};

const fileCard: CSSProperties = {
    backgroundColor: colors.cardSurface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: '16px',
    margin: `0 0 ${spacing.block}`,
};

const fileIconCell: CSSProperties = {
    width: '52px',
    verticalAlign: 'middle',
};

const fileIconCircle: CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: radii.pill,
    backgroundColor: colors.accentSurface,
    padding: '10px',
    boxSizing: 'border-box',
};

const fileMetaCell: CSSProperties = {
    verticalAlign: 'middle',
};

const fileName_: CSSProperties = {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: colors.ink,
    lineHeight: '20px',
    wordBreak: 'break-all',
};

const fileSub: CSSProperties = {
    margin: '2px 0 0',
    fontSize: '13px',
    lineHeight: '18px',
    color: colors.success,
    fontWeight: 500,
};

const buttonSection: CSSProperties = {
    margin: `0 0 ${spacing.block}`,
};

const button: CSSProperties = {
    display: 'block',
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center',
    padding: '13px 20px',
    borderRadius: radii.sm,
};

const callout: CSSProperties = {
    backgroundColor: colors.accentSurfaceSoft,
    border: `1px solid ${colors.accentSurface}`,
    borderRadius: radii.md,
    padding: '12px 16px',
};

const calloutIconCell: CSSProperties = {
    width: '26px',
    verticalAlign: 'top',
    paddingTop: '2px',
};

const calloutText: CSSProperties = {
    margin: 0,
    fontSize: '13px',
    lineHeight: '20px',
    color: colors.primaryText,
};

const calloutStrong: CSSProperties = {
    fontWeight: 600,
    color: colors.primaryTextStrong,
};

const footerLabel: CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: colors.muted,
    margin: '0 0 4px',
};

const footerLink: CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: colors.faint,
    margin: '0 0 20px',
    wordBreak: 'break-all',
};
