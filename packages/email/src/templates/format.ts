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
