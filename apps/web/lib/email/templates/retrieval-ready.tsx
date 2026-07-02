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
import { Callout, CalloutStrong } from './components/callout';
import { ArchiveIcon, ClockIcon } from './components/icons';
import { LinkFallback } from './components/link-fallback';
import { formatEmailDateTime } from './format';
import { button, buttonSection, heading, intro, introStrong } from './styles';
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
            footer={<LinkFallback url={downloadUrl} />}
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

            {/* This link is time-boxed, so the expiry gets its own weight
                rather than being buried in prose. */}
            <Callout icon={<ClockIcon size={16} color={colors.primary} />}>
                This link expires on{' '}
                <CalloutStrong>{formattedExpiry}</CalloutStrong>. After that,
                request the file again from your library.
            </Callout>
        </EmailLayout>
    );
}

// --- Styles -----------------------------------------------------------------

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
