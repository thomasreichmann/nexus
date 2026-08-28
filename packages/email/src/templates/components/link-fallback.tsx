/**
 * "Button not working?" plain-text link fallback. Templates with a primary
 * action pass this through EmailLayout's `footer` slot so the fallback copy
 * stays identical across the email library.
 */
import type { CSSProperties } from 'react';
import { Text } from '@react-email/components';
import { colors } from '../theme';

interface LinkFallbackProps {
    url: string;
}

export function LinkFallback({ url }: LinkFallbackProps) {
    return (
        <>
            <Text style={footerLabel}>
                Button not working? Paste this link into your browser:
            </Text>
            <Text style={footerLink}>{url}</Text>
        </>
    );
}

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
