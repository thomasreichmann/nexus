'use client';

import * as React from 'react';
import { loadThemePreference, saveThemePreference } from './storage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const MODE_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

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
    const [systemPrefersDark, setSystemPrefersDark] = React.useState(false);
    const [isTransitioning, setIsTransitioning] = React.useState(false);
    const transitionTimeoutRef = React.useRef<number | undefined>(undefined);

    // Load the persisted mode and track live OS theme changes
    React.useEffect(() => {
        setMode(loadThemePreference() ?? 'system');

        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const update = () => setSystemPrefersDark(query.matches);
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
            const next =
                MODE_CYCLE[(MODE_CYCLE.indexOf(prev) + 1) % MODE_CYCLE.length];
            saveThemePreference(next);
            return next;
        });

        setIsTransitioning(true);
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = window.setTimeout(
            () => setIsTransitioning(false),
            200
        );
    }, []);

    const resolvedTheme: ResolvedTheme | null = !isMounted
        ? null
        : mode === 'system'
          ? systemPrefersDark
              ? 'dark'
              : 'light'
          : mode;

    return { mode, resolvedTheme, cycleMode, isTransitioning };
}
