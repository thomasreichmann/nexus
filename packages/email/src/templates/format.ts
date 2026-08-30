/**
 * Emails are read in an unknown timezone, so dates must be formatted against
 * a fixed zone with an explicit label — never the server's local time (the
 * in-app formatters in `lib/format.ts` render in local time, which is correct
 * there because the browser's clock is the reader's clock).
 */
const emailDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
});

export function formatEmailDateTime(date: Date): string {
    return `${emailDateTimeFormatter.format(date)} UTC`;
}

/**
 * Byte sizes for email copy. A sibling of `formatBytes` in
 * `apps/web/lib/format.ts` rather than an import of it, for the same reason
 * this package exists at all: the worker sends these messages and cannot reach
 * into the app (#364). The two are allowed to drift in precision — this one is
 * read once in an inbox, not scanned down a column — but not in units.
 */
export function formatEmailBytes(bytes: number): string {
    if (bytes <= 0) return '0 Bytes';
    const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    const value = bytes / Math.pow(1024, exponent);
    return `${Number.parseFloat(value.toFixed(2))} ${units[exponent]}`;
}
