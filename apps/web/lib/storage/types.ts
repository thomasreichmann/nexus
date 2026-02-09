// Re-export from canonical source in @nexus/db
export { RESTORE_TIERS, type RestoreTier } from '@nexus/db';

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
