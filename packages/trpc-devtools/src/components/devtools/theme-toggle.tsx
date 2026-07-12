'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThemeMode } from '@/lib/use-theme';

const MODE_LABELS: Record<ThemeMode, string> = {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
};

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
};

interface ThemeToggleProps {
    mode: ThemeMode;
    onCycle: () => void;
}

export function ThemeToggle({ mode, onCycle }: ThemeToggleProps) {
    const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
    const label = `Theme: ${MODE_LABELS[mode]} — switch to ${MODE_LABELS[NEXT_MODE[mode]]}`;

    return (
        <button
            type="button"
            onClick={onCycle}
            title={label}
            aria-label={label}
            className={cn(
                'flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
                'hover:bg-accent/50 hover:text-foreground',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
            )}
        >
            <Icon className="h-4 w-4" />
        </button>
    );
}
