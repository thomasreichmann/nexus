import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Hr,
    Html,
    Preview,
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
                    <Heading style={heading}>Your file is ready</Heading>
                    <Text style={text}>
                        <strong>{fileName}</strong> has finished restoring from
                        archive and is ready to download.
                    </Text>
                    <Section style={buttonSection}>
                        <Button style={button} href={downloadUrl}>
                            Download file
                        </Button>
                    </Section>
                    <Text style={text}>
                        This download link expires on {formattedExpiry}. After
                        that, you can request the file again from your library.
                    </Text>
                    <Hr style={hr} />
                    <Text style={footer}>
                        If the button doesn&apos;t work, copy and paste this
                        link into your browser:
                        <br />
                        {downloadUrl}
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

export default RetrievalReadyEmail;

const body: React.CSSProperties = {
    backgroundColor: '#f4f4f5',
    fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container: React.CSSProperties = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '32px',
    maxWidth: '480px',
    borderRadius: '8px',
};

const heading: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 600,
    color: '#18181b',
    margin: '0 0 16px',
};

const text: React.CSSProperties = {
    fontSize: '14px',
    lineHeight: '22px',
    color: '#3f3f46',
};

const buttonSection: React.CSSProperties = {
    margin: '24px 0',
};

const button: React.CSSProperties = {
    backgroundColor: '#18181b',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    textDecoration: 'none',
    padding: '12px 20px',
    borderRadius: '6px',
};

const hr: React.CSSProperties = {
    borderColor: '#e4e4e7',
    margin: '24px 0',
};

const footer: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: '#a1a1aa',
    wordBreak: 'break-all',
};
