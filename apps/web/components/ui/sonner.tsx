'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Theme-aware Sonner toaster. Sonner defaults to its light theme, which is
 * what put light-grey toasts on top of the dark UI; next-themes owns the
 * app's theme (class attribute), so the toaster has to be told explicitly.
 * Must render inside `ThemeProvider` for `useTheme` to resolve.
 */
export function Toaster(props: ToasterProps) {
    const { resolvedTheme } = useTheme();
    return (
        <Sonner
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            {...props}
        />
    );
}
