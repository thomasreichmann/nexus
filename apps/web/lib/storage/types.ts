/**
 * Glacier restore tier values - determines retrieval speed and cost
 * These are also used to define the database enum in server/db/schema/storage.ts
 *
 * For Deep Archive (MVP default):
 * - expedited: Not available for Deep Archive
 * - standard: 12-48 hours
 * - bulk: 48 hours (cheapest)
 *
 * For Glacier Flexible Retrieval:
 * - expedited: 1-5 minutes (most expensive)
 * - standard: 3-5 hours
 * - bulk: 5-12 hours
 */
export const RESTORE_TIERS = ['standard', 'bulk', 'expedited'] as const;
export type RestoreTier = (typeof RESTORE_TIERS)[number];

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
