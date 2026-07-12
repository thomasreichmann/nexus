'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';

export interface DrawerProps {
    isOpen: boolean;
    onClose: () => void;
    /** Accessible name for the drawer dialog */
    label: string;
    className?: string;
    children: React.ReactNode;
}

/**
 * Slide-out panel anchored to the left edge with a backdrop overlay.
 *
 * While open: Escape closes, Tab focus is trapped inside the panel, and
 * clicking the backdrop closes. Focus returns to the previously focused
 * element (e.g. the trigger button) on close.
 */
export function Drawer({
    isOpen,
    onClose,
    label,
    className,
    children,
}: DrawerProps) {
    const panelRef = React.useRef<HTMLDivElement>(null);

    // The trap focuses the panel itself rather than the first focusable
    // element so opening the drawer doesn't pop the virtual keyboard via
    // the search input on touch devices.
    useFocusTrap(panelRef, { isOpen, onClose });

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        className="fixed inset-0 z-40 bg-black/60"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={onClose}
                        aria-hidden="true"
                    />
                    <motion.div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={label}
                        tabIndex={-1}
                        className={cn(
                            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background focus:outline-none',
                            className
                        )}
                        initial={{ x: '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-100%' }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        {children}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
