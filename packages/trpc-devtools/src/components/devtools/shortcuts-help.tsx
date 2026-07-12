'use client';

import * as React from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { formatShortcut, useIsApplePlatform } from '@/lib/platform';

interface ShortcutsHelpProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Keyboard shortcut reference, opened with Cmd+? (Cmd+Shift+/).
 */
export function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
    const isApple = useIsApplePlatform();

    const shortcuts: Array<{ keys: string[]; description: string }> = [
        {
            keys: [formatShortcut('K', { isApple })],
            description: 'Open command palette',
        },
        {
            keys: [formatShortcut('↵', { isApple })],
            description: 'Execute request',
        },
        {
            keys: [formatShortcut('L', { isApple, isShift: true })],
            description: 'Clear response',
        },
        {
            keys: [
                formatShortcut('[', { isApple }),
                formatShortcut(']', { isApple }),
            ],
            description: 'Previous / next procedure',
        },
        {
            keys: [formatShortcut('F', { isApple, isShift: true })],
            description: 'Format JSON input (in editor)',
        },
        { keys: ['/'], description: 'Focus procedure search' },
        {
            keys: [formatShortcut('?', { isApple })],
            description: 'Keyboard shortcuts',
        },
        { keys: ['Esc'], description: 'Close dialog or palette' },
    ];

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            label="Keyboard shortcuts"
            className="max-w-md"
        >
            <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
            </div>
            <ul className="p-2">
                {shortcuts.map((shortcut) => (
                    <li
                        key={shortcut.description}
                        className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5"
                    >
                        <span className="text-sm text-foreground">
                            {shortcut.description}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            {shortcut.keys.map((key, i) => (
                                <React.Fragment key={key}>
                                    {i > 0 && (
                                        <span className="text-[10px] text-muted-foreground">
                                            /
                                        </span>
                                    )}
                                    <Kbd>{key}</Kbd>
                                </React.Fragment>
                            ))}
                        </span>
                    </li>
                ))}
            </ul>
        </Dialog>
    );
}
