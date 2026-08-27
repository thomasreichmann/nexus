// Re-export from the canonical source in @nexus/db. Everything here comes from
// `@nexus/db/objectState`, never `@nexus/db/schema`: `RetrieveDialog` imports
// `DEFAULT_RESTORE_DAYS_TO_KEEP` from this file, so reaching for the schema
// barrel would ship drizzle and every table definition to the browser.
export {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    RESTORE_TIERS,
    type RestoreTier,
    type ObjectState,
    type ObjectAvailability,
} from '@nexus/db/objectState';

export interface PutPresignOptions {
    contentType?: string;
    contentLength?: number;
    /** URL expiration in seconds (default: 900 = 15 minutes) */
    expiresIn?: number;
}

export interface GetPresignOptions {
    /** URL expiration in seconds (default: 3600 = 1 hour) */
    expiresIn?: number;
    /** Sets Content-Disposition header for download filename */
    filename?: string;
}
