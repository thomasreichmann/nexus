/**
 * Glacier restore tier - determines retrieval speed and cost
 * - expedited: 1-5 minutes (most expensive)
 * - standard: 3-5 hours
 * - bulk: 5-12 hours (cheapest)
 */
export type RestoreTier = 'expedited' | 'standard' | 'bulk';

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
