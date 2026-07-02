// Re-export from canonical source in @nexus/db
export { RESTORE_TIERS, type RestoreTier } from '@nexus/db/schema';

/**
 * Days a restored Glacier copy stays accessible. Also the length of the
 * synthetic download window for standard-tier retrievals, which skip S3
 * restore entirely — keep the two in lockstep so both tiers present the
 * same window.
 */
export const DEFAULT_RESTORE_DAYS_TO_KEEP = 7;

export interface RestoreStatus {
    status: 'not-started' | 'in-progress' | 'completed';
    /** Present only when status === 'completed' */
    expiresAt?: Date;
}

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
