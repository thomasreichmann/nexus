'use client';

import * as React from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface FocusTrapOptions {
    isOpen: boolean;
    onClose: () => void;
    /**
     * Element to focus when the trap activates. Defaults to the container
     * itself (which must have tabIndex={-1}).
     */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Modal focus behavior shared by Drawer and Dialog: on open, move focus
 * inside; while open, Escape closes and Tab cycles within the container;
 * on close, restore focus to the previously focused element.
 */
export function useFocusTrap(
    containerRef: React.RefObject<HTMLElement | null>,
    { isOpen, onClose, initialFocusRef }: FocusTrapOptions
): void {
    React.useEffect(() => {
        if (!isOpen) return;

        const previouslyFocused = document.activeElement;

        (initialFocusRef?.current ?? containerRef.current)?.focus();

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
                return;
            }

            if (e.key !== 'Tab' || !containerRef.current) return;

            const focusable = Array.from(
                containerRef.current.querySelectorAll<HTMLElement>(
                    FOCUSABLE_SELECTOR
                )
            );
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            const isOutside = !containerRef.current.contains(active);

            if (e.shiftKey && (active === first || isOutside)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || isOutside)) {
                e.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused instanceof HTMLElement) {
                previouslyFocused.focus();
            }
        };
    }, [isOpen, onClose, containerRef, initialFocusRef]);
}
