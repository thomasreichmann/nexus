'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';

export interface DialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Accessible name for the dialog */
    label: string;
    /** Element to focus when the dialog opens (defaults to the panel) */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    className?: string;
    children: React.ReactNode;
}

/**
 * Top-anchored modal panel with a backdrop overlay (command-palette style).
 *
 * While open: Escape closes, Tab focus is trapped inside the panel, and
 * clicking the backdrop closes. Focus returns to the previously focused
 * element on close. Rendered in place (no portal) so it stays inside the
 * `.trpc-devtools` scope for theming.
 */
export function Dialog({
    isOpen,
    onClose,
    label,
    initialFocusRef,
    className,
    children,
}: DialogProps) {
    const panelRef = React.useRef<HTMLDivElement>(null);

    useFocusTrap(panelRef, { isOpen, onClose, initialFocusRef });

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        onClick={onClose}
                        aria-hidden="true"
                    />
                    <div className="pointer-events-none fixed inset-x-0 top-[12%] z-50 flex justify-center px-4">
                        <motion.div
                            ref={panelRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label={label}
                            tabIndex={-1}
                            className={cn(
                                'pointer-events-auto flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl focus:outline-none',
                                className
                            )}
                            initial={{ opacity: 0, y: -12, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -12, scale: 0.97 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                        >
                            {children}
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
