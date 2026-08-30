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
import { formatEmailBytes, formatEmailDateTime } from './format';
import { button, buttonSection, heading, intro, introStrong } from './styles';
import { colors, radii, spacing } from './theme';

export interface RetrievalRequestReadyEmailProps {
    /**
     * A link into the app, never a presigned S3 URL: the app re-checks
     * ownership and mints a fresh short-lived GET on the click, which can
     * happen days after this message was sent (#426).
     */
    downloadUrl: string;
    /** Files the user asked for — always ≥ 2, or this would be a single-file restore. */
    fileCount: number;
    /** Zip artifacts the request was partitioned into; 1 is the common case. */
    partCount: number;
    totalBytes: number;
    /**
     * When the artifacts stop being downloadable. The artifacts' own clock —
     * seven days from the build — not the two-day window of the thawed
     * originals behind them.
     */
    expiresAt: Date;
}

/**
 * Subject line for this email. Co-located with the component so the whole
 * message — subject, preview, body — reads and tests as one unit, and a copy
 * change can't drift between the inbox line and the body.
 */
export function retrievalRequestReadySubject({
    fileCount,
}: Pick<RetrievalRequestReadyEmailProps, 'fileCount'>): string {
    return `Your ${fileCount} files are ready to download`;
}

/**
 * The multi-file counterpart to `RetrievalReadyEmail`.
 *
 * A separate template rather than a variant of that one: the single-file
 * message names a file and points at it, this one names a count and points at a
 * request, and every string differs. #437 keeps the other as-is.
 *
 * Sent once per request, by the zip worker, when the last artifact finishes
 * building.
 */
export function RetrievalRequestReadyEmail({
    downloadUrl,
    fileCount,
    partCount,
    totalBytes,
    expiresAt,
}: RetrievalRequestReadyEmailProps) {
    // e.g. "July 8, 2026 at 3:45 PM UTC" — explicit zone since the reader's is unknown
    const formattedExpiry = formatEmailDateTime(expiresAt);
    const isMultiPart = partCount > 1;

    return (
        <EmailLayout
            preview={`${fileCount} files are ready to download`}
            footer={<LinkFallback url={downloadUrl} />}
        >
            <Heading style={heading}>Your files are ready</Heading>
            <Text style={intro}>
                <strong style={introStrong}>{fileCount} files</strong> have
                finished restoring from archive.{' '}
                {isMultiPart
                    ? `They are packaged as ${partCount} zip archives, and you'll need all of them.`
                    : 'They are packaged as a single zip archive.'}
            </Text>

            {/* Request card — the multi-file echo of the single-file template's
                file card, summarising what was restored rather than naming it. */}
            <Section style={requestCard}>
                <Row>
                    <Column style={requestIconCell}>
                        <div style={requestIconCircle}>
                            <ArchiveIcon size={20} color={colors.primary} />
                        </div>
                    </Column>
                    <Column style={requestMetaCell}>
                        <Text style={requestSummary}>
                            {fileCount} files · {formatEmailBytes(totalBytes)}
                        </Text>
                        <Text style={requestSub}>
                            {isMultiPart
                                ? `Ready to download · ${partCount} parts`
                                : 'Ready to download'}
                        </Text>
                    </Column>
                </Row>
            </Section>

            <Section style={buttonSection}>
                <Button style={button} href={downloadUrl}>
                    {isMultiPart ? 'Download your files' : 'Download your zip'}
                </Button>
            </Section>

            {/* The download window is the artifact's own, so the expiry gets its
                own weight rather than being buried in prose. */}
            <Callout icon={<ClockIcon size={16} color={colors.primary} />}>
                {isMultiPart ? 'These downloads stay' : 'This download stays'}{' '}
                available until <CalloutStrong>{formattedExpiry}</CalloutStrong>
                . After that, request the files again from your library.
            </Callout>
        </EmailLayout>
    );
}

// --- Styles -----------------------------------------------------------------

const requestCard: CSSProperties = {
    backgroundColor: colors.cardSurface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: '16px',
    margin: `0 0 ${spacing.block}`,
};

const requestIconCell: CSSProperties = {
    width: '52px',
    verticalAlign: 'middle',
};

const requestIconCircle: CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: radii.pill,
    backgroundColor: colors.accentSurface,
    padding: '10px',
    boxSizing: 'border-box',
};

const requestMetaCell: CSSProperties = { verticalAlign: 'middle' };

const requestSummary: CSSProperties = {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: colors.ink,
    lineHeight: '20px',
};

const requestSub: CSSProperties = {
    margin: '2px 0 0',
    fontSize: '13px',
    lineHeight: '18px',
    color: colors.success,
    fontWeight: 500,
};
