/**
 * Emails are read in an unknown timezone, so dates must be formatted against
 * a fixed zone with an explicit label — never the server's local time
 * (`lib/format.ts`'s `formatDateTime` is for in-app UI, where local time is
 * correct because the browser's clock is the reader's clock).
 */
export function formatEmailDateTime(date: Date): string {
    const formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(date);
    return `${formatted} UTC`;
}
