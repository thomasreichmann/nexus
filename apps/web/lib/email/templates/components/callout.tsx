/**
 * Icon + message callout for notes that deserve their own weight (expiries,
 * time-boxed links). The message is children so copy stays per-template; wrap
 * emphasized runs in <CalloutStrong>.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Column, Row, Section, Text } from '@react-email/components';
import { colors, radii } from '../theme';

interface CalloutProps {
    /** Rendered in the leading cell — typically a 16px primary-colored icon. */
    icon: ReactNode;
    children: ReactNode;
}

export function Callout({ icon, children }: CalloutProps) {
    return (
        <Section style={callout}>
            <Row>
                <Column style={calloutIconCell}>{icon}</Column>
                <Column>
                    <Text style={calloutText}>{children}</Text>
                </Column>
            </Row>
        </Section>
    );
}

export function CalloutStrong({ children }: { children: ReactNode }) {
    return <strong style={calloutStrong}>{children}</strong>;
}

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
