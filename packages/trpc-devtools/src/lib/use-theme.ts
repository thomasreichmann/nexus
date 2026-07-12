'use client';

import * as React from 'react';
import {
    loadThemePreference,
    saveThemePreference,
    THEME_MODES,
    type ThemeMode,
} from './storage';

export type { ThemeMode };
export type ResolvedTheme = 'light' | 'dark';

// Must stay >= the 150ms `.theme-transition` duration in styles/globals.css
// (a little slack so the class outlives the CSS transition)
const THEME_TRANSITION_CLEAR_MS = 200;

/** The mode a toggle moves to next: Light → Dark → System → Light */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
    return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
}

export interface UseThemeResult {
    /** The user's selected mode (may be 'system') */
    mode: ThemeMode;
    /**
     * The concrete theme currently in effect, or null before mount.
     * Null means "apply no theme class": the wrapper then inherits the host
     * page's `.dark` class (embedded) or the FOUC script's html class
     * (standalone), keeping server and client initial renders identical.
     */
    resolvedTheme: ResolvedTheme | null;
    /** Cycle Light → Dark → System */
    cycleMode: () => void;
    /**
     * True for a short window after a user-initiated mode change, so the
     * caller can apply a CSS transition class only while switching (a
     * permanent transition on colors would interfere with hover effects).
     */
    isTransitioning: boolean;
}

/**
 * Theme state for the devtools. Persists the selected mode in localStorage
 * and tracks the OS preference live while in 'system' mode.
 *
 * The caller is responsible for applying `resolvedTheme` as a class on the
 * `.trpc-devtools` wrapper — theming is wrapper-scoped so an embedded
 * devtools never fights the host page's theme.
 */
export function useTheme(): UseThemeResult {
    // localStorage and matchMedia are read only after mount (never in initial
    // state) so the SSR'd and hydrated first renders match — a className
    // hydration mismatch is never patched up by React.
    const [isMounted, setIsMounted] = React.useState(false);
    const [mode, setMode] = React.useState<ThemeMode>('system');
    const [isSystemDark, setIsSystemDark] = React.useState(false);
    const [isTransitioning, setIsTransitioning] = React.useState(false);
    const transitionTimeoutRef = React.useRef<number | undefined>(undefined);

    // Load the persisted mode and track live OS theme changes
    React.useEffect(() => {
        setMode(loadThemePreference() ?? 'system');

        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const update = () => setIsSystemDark(query.matches);
        update();
        setIsMounted(true);

        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    React.useEffect(() => {
        return () => window.clearTimeout(transitionTimeoutRef.current);
    }, []);

    const cycleMode = React.useCallback(() => {
        setMode((prev) => {
            const next = nextThemeMode(prev);
            saveThemePreference(next);
            return next;
        });

        setIsTransitioning(true);
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = window.setTimeout(
            () => setIsTransitioning(false),
            THEME_TRANSITION_CLEAR_MS
        );
    }, []);

    const resolvedTheme: ResolvedTheme | null = !isMounted
        ? null
        : mode === 'system'
          ? isSystemDark
              ? 'dark'
              : 'light'
          : mode;

    return { mode, resolvedTheme, cycleMode, isTransitioning };
}
