'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UploadNavigationGuard {
    /** Href of an intercepted in-app link click awaiting the user's decision. */
    pendingHref: string | null;
    confirmNavigation: () => void;
    cancelNavigation: () => void;
}

/**
 * Guards an active upload wave against being killed by navigation (#398): the
 * whole engine lives in the upload page's tree, so leaving unmounts it and
 * aborts every in-flight PUT — silently, and single-part files leave nothing
 * to resume. While `isActive`, tab close / reload gets the browser's
 * beforeunload prompt, and same-origin link clicks (sidebar, mobile menu,
 * in-page links) are intercepted into a confirm dialog the caller renders.
 *
 * Not covered: the header's sign-out (a router.push, not a link) and browser
 * back/forward — the App Router owns popstate and can't reliably block it.
 */
export function useUploadNavigationGuard(
    isActive: boolean
): UploadNavigationGuard {
    const router = useRouter();
    const [pendingHref, setPendingHref] = useState<string | null>(null);

    // A wave that finishes (or is cleared) with the dialog open closes it —
    // leaving is harmless then, so the "will stop your uploads" copy would
    // lie. Adjusted during render (not in an effect) so the stale prompt
    // never paints and can't resurface when a later wave starts.
    if (!isActive && pendingHref !== null) {
        setPendingHref(null);
    }

    // Both listeners arm and disarm with the wave: registered only while it
    // runs, removed by the effect cleanup, so an idle upload page carries no
    // guard at all.
    useEffect(() => {
        if (!isActive) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            // preventDefault is what modern Chromium honors; returnValue is
            // the legacy channel other engines still need for the prompt.
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;
        // Capture phase on the document, ahead of Next's own Link handler:
        // Link bails on a defaultPrevented event, so preventDefault alone
        // stops the soft navigation while other click handlers (the mobile
        // sheet closing itself, dropdown items) still run. Document level is
        // what covers the sidebar/header links living outside this page's
        // tree without plumbing state to them.
        const onClick = (event: MouseEvent) => {
            const href = getInterceptableHref(event);
            if (!href) return;
            event.preventDefault();
            setPendingHref(href);
        };
        document.addEventListener('click', onClick, { capture: true });
        return () =>
            document.removeEventListener('click', onClick, { capture: true });
    }, [isActive]);

    const confirmNavigation = useCallback(() => {
        if (pendingHref) router.push(pendingHref);
        setPendingHref(null);
    }, [pendingHref, router]);

    const cancelNavigation = useCallback(() => setPendingHref(null), []);

    return { pendingHref, confirmNavigation, cancelNavigation };
}

// A click worth intercepting: primary button, unmodified, on a same-origin
// link that would replace this document. Modified clicks and target="_blank"
// open a new tab (the wave keeps running here), and a cross-origin navigation
// is a full unload the beforeunload prompt already covers.
function getInterceptableHref(event: MouseEvent): string | null {
    if (event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return null;
    if (!(event.target instanceof Element)) return null;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    if (anchor.target && anchor.target !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    // Same-path clicks don't unmount the page (no remount, no lost wave).
    if (url.pathname === window.location.pathname) return null;
    return url.pathname + url.search + url.hash;
}
