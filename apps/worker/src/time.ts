/**
 * Null rather than a misleading zero when either end of the span is unknown —
 * a request whose rows were all adopted warm never had a restore initiated,
 * so its thaw time is honestly "no data", not 0s.
 */
export function elapsedSeconds(
    from: Date | null,
    to: Date | null
): number | null {
    if (!from || !to) return null;
    return Math.round((to.getTime() - from.getTime()) / 1000);
}
