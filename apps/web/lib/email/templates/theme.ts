/**
 * Shared design tokens for transactional email templates.
 *
 * Email clients don't support CSS variables or external stylesheets, so every
 * template styles inline. These tokens keep the palette, type, and shape in one
 * place — matched to the app's design tokens (zinc neutrals + blue-700) — so a
 * brand change is one edit here instead of one per template.
 */

export const colors = {
    // Brand
    primary: '#1d4ed8', // blue-700 — band, button, accents
    primaryText: '#1e40af', // blue-800 — text on light-blue surfaces
    primaryTextStrong: '#1e3a8a', // blue-900 — emphasis on light-blue surfaces
    accentSurface: '#dbeafe', // blue-100 — icon circles, callout borders
    accentSurfaceSoft: '#eff6ff', // blue-50 — callout background

    // Neutrals (zinc)
    ink: '#18181b', // zinc-900 — headings, primary text
    body: '#52525b', // zinc-600 — body copy
    muted: '#71717a', // zinc-500 — secondary labels
    faint: '#a1a1aa', // zinc-400 — footer, de-emphasized links
    border: '#e4e4e7', // zinc-200 — hairlines, card borders
    cardSurface: '#fafafa', // zinc-50 — file card
    canvas: '#f4f4f5', // zinc-100 — page background

    // Semantic
    success: '#3f9142', // status text (e.g. "Ready to download")

    surface: '#ffffff',
    onPrimary: '#ffffff',
} as const;

export const fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const radii = {
    sm: '8px',
    md: '10px',
    lg: '12px',
    pill: '20px',
} as const;

export const spacing = {
    /** Horizontal gutter for the band and content sections. */
    gutter: '32px',
    /** Vertical rhythm between stacked content blocks. */
    block: '24px',
} as const;
