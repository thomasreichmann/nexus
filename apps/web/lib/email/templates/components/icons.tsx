/**
 * Inline icon glyphs for email templates.
 *
 * Lucide paths inlined as SVG so an email carries no external asset (many
 * clients block remote images by default). Icons are decoration only — meaning
 * never depends on them, so no title/role is set.
 */
import type { CSSProperties } from 'react';

interface IconProps {
    size: number;
    color: string;
}

const iconSvg: CSSProperties = {
    display: 'block',
};

function Icon({
    size,
    color,
    children,
}: IconProps & { children: React.ReactNode }) {
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
            {children}
        </svg>
    );
}

export function ArchiveIcon({ size, color }: IconProps) {
    return (
        <Icon size={size} color={color}>
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </Icon>
    );
}

export function ClockIcon({ size, color }: IconProps) {
    return (
        <Icon size={size} color={color}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </Icon>
    );
}
