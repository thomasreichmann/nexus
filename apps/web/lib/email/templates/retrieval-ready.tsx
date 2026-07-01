import {
    Body,
    Button,
    Column,
    Container,
    Head,
    Heading,
    Hr,
    Html,
    Preview,
    Row,
    Section,
    Text,
} from '@react-email/components';
import { formatDateTime } from '@/lib/format';

export interface RetrievalReadyEmailProps {
    fileName: string;
    downloadUrl: string;
    expiresAt: Date;
}

export function RetrievalReadyEmail({
    fileName,
    downloadUrl,
    expiresAt,
}: RetrievalReadyEmailProps) {
    // e.g. "July 8, 2026 at 3:45 PM" — readable in a plain-text fallback too
    const formattedExpiry = formatDateTime(expiresAt);

    return (
        <Html>
            <Head />
            <Preview>{`${fileName} is ready to download`}</Preview>
            <Body style={body}>
                <Container style={container}>
                    {/* Brand band — the icon degrades to the wordmark if a
                        client strips inline SVG (e.g. Gmail webmail). */}
                    <Section style={band}>
                        <Row>
                            <Column style={brandMarkCell}>
                                <ArchiveIcon size={20} color="#ffffff" />
                            </Column>
                            <Column>
                                <Text style={wordmark}>Nexus</Text>
                            </Column>
                        </Row>
                    </Section>

                    <Section style={content}>
                        <Heading style={heading}>Your file is ready</Heading>
                        <Text style={intro}>
                            <strong style={introStrong}>{fileName}</strong> has
                            finished restoring from archive and is ready to
                            download.
                        </Text>

                        {/* File card — mirrors how a file reads in the app. */}
                        <Section style={fileCard}>
                            <Row>
                                <Column style={fileIconCell}>
                                    <div style={fileIconCircle}>
                                        <ArchiveIcon
                                            size={20}
                                            color="#1d4ed8"
                                        />
                                    </div>
                                </Column>
                                <Column style={fileMetaCell}>
                                    <Text style={fileName_}>{fileName}</Text>
                                    <Text style={fileSub}>
                                        Ready to download
                                    </Text>
                                </Column>
                            </Row>
                        </Section>

                        <Section style={buttonSection}>
                            <Button style={button} href={downloadUrl}>
                                Download file
                            </Button>
                        </Section>

                        {/* Expiry callout — this link is time-boxed, so give
                            it its own weight rather than burying it in prose. */}
                        <Section style={callout}>
                            <Row>
                                <Column style={calloutIconCell}>
                                    <ClockIcon size={16} color="#1d4ed8" />
                                </Column>
                                <Column>
                                    <Text style={calloutText}>
                                        This link expires on{' '}
                                        <strong style={calloutStrong}>
                                            {formattedExpiry}
                                        </strong>
                                        . After that, request the file again
                                        from your library.
                                    </Text>
                                </Column>
                            </Row>
                        </Section>

                        <Hr style={hr} />

                        <Text style={footerLabel}>
                            Button not working? Paste this link into your
                            browser:
                        </Text>
                        <Text style={footerLink}>{downloadUrl}</Text>
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

export default RetrievalReadyEmail;

// --- Inline icons -----------------------------------------------------------
// Lucide glyphs (archive, clock) inlined so the email carries no external
// asset. Rendered as decoration; meaning never depends on them.

function ArchiveIcon({ size, color }: { size: number; color: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconSvg}
        >
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    );
}

function ClockIcon({ size, color }: { size: number; color: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconSvg}
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

// --- Styles -----------------------------------------------------------------
// Zinc neutrals + blue-700 primary, matched to the app's design tokens.

const body: React.CSSProperties = {
    backgroundColor: '#f4f4f5',
    margin: 0,
    padding: '32px 0',
    fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container: React.CSSProperties = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    maxWidth: '480px',
    borderRadius: '12px',
    border: '1px solid #e4e4e7',
    overflow: 'hidden',
};

const band: React.CSSProperties = {
    backgroundColor: '#1d4ed8',
    padding: '18px 32px',
};

const brandMarkCell: React.CSSProperties = {
    width: '30px',
    verticalAlign: 'middle',
};

const wordmark: React.CSSProperties = {
    margin: 0,
    fontSize: '17px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: '#ffffff',
    lineHeight: '20px',
};

const content: React.CSSProperties = {
    padding: '32px',
};

const heading: React.CSSProperties = {
    fontSize: '22px',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: '#18181b',
    margin: '0 0 12px',
};

const intro: React.CSSProperties = {
    fontSize: '15px',
    lineHeight: '24px',
    color: '#52525b',
    margin: '0 0 24px',
};

const introStrong: React.CSSProperties = {
    color: '#18181b',
    fontWeight: 600,
};

const fileCard: React.CSSProperties = {
    backgroundColor: '#fafafa',
    border: '1px solid #e4e4e7',
    borderRadius: '10px',
    padding: '16px',
    margin: '0 0 24px',
};

const fileIconCell: React.CSSProperties = {
    width: '52px',
    verticalAlign: 'middle',
};

const fileIconCircle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: '20px',
    backgroundColor: '#dbeafe',
    padding: '10px',
    boxSizing: 'border-box',
};

const fileMetaCell: React.CSSProperties = {
    verticalAlign: 'middle',
};

const fileName_: React.CSSProperties = {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: '#18181b',
    lineHeight: '20px',
    wordBreak: 'break-all',
};

const fileSub: React.CSSProperties = {
    margin: '2px 0 0',
    fontSize: '13px',
    lineHeight: '18px',
    color: '#3f9142',
    fontWeight: 500,
};

const buttonSection: React.CSSProperties = {
    margin: '0 0 24px',
};

const button: React.CSSProperties = {
    display: 'block',
    backgroundColor: '#1d4ed8',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center',
    padding: '13px 20px',
    borderRadius: '8px',
};

const callout: React.CSSProperties = {
    backgroundColor: '#eff6ff',
    border: '1px solid #dbeafe',
    borderRadius: '10px',
    padding: '12px 16px',
};

const calloutIconCell: React.CSSProperties = {
    width: '26px',
    verticalAlign: 'top',
    paddingTop: '2px',
};

const calloutText: React.CSSProperties = {
    margin: 0,
    fontSize: '13px',
    lineHeight: '20px',
    color: '#1e40af',
};

const calloutStrong: React.CSSProperties = {
    fontWeight: 600,
    color: '#1e3a8a',
};

const hr: React.CSSProperties = {
    borderColor: '#e4e4e7',
    margin: '24px 0',
};

const footerLabel: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: '#71717a',
    margin: '0 0 4px',
};

const footerLink: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: '#a1a1aa',
    margin: '0 0 20px',
    wordBreak: 'break-all',
};

const footerBrand: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: '#a1a1aa',
    margin: 0,
};

const iconSvg: React.CSSProperties = {
    display: 'block',
};
