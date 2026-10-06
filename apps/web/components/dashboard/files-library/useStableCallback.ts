'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but always runs the latest `fn`.
 * Lets a memoized child (the batch pane's 100 tiles) skip the parent's
 * re-renders, which the viewer's open/close triggers several times a second.
 * For event handlers only: it reads the latest `fn` at call time, never
 * during render.
 */
export function useStableCallback<Args extends unknown[], Result>(
    fn: (...args: Args) => Result
): (...args: Args) => Result {
    const latest = useRef(fn);
    useLayoutEffect(() => {
        latest.current = fn;
    });
    return useCallback((...args: Args) => latest.current(...args), []);
}
