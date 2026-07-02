/**
 * Composed style constants shared across email templates — one level above
 * theme.ts's raw tokens. Every template's heading/intro/primary-button should
 * look identical; a template needing a one-off variation defines its own
 * constant locally rather than forking these.
 */
import type { CSSProperties } from 'react';
import { colors, radii, spacing } from './theme';

export const heading: CSSProperties = {
    fontSize: '22px',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: colors.ink,
    margin: '0 0 12px',
};

export const intro: CSSProperties = {
    fontSize: '15px',
    lineHeight: '24px',
    color: colors.body,
    margin: `0 0 ${spacing.block}`,
};

export const introStrong: CSSProperties = {
    color: colors.ink,
    fontWeight: 600,
};

export const buttonSection: CSSProperties = {
    margin: `0 0 ${spacing.block}`,
};

export const button: CSSProperties = {
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
