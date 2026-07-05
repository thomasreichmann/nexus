import { z } from 'zod';

export const logErrorVerbositySchema = z.enum(['minimal', 'standard', 'full']);

// Server-side env vars (not exposed to client)
export const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    SQS_QUEUE_URL: z.string().url(),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    // Resend accepts a friendly-from format ("Name <addr@domain>"), which
    // z.string().email() rejects — this only checks it's non-empty and lets
    // Resend validate the actual address on send.
    RESEND_FROM_EMAIL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    LOG_ERROR_VERBOSITY: logErrorVerbositySchema.optional(),
    // Unset (local dev, tests, preview) disables the Discord alert transport.
    DISCORD_ALERT_WEBHOOK_URL: z.string().url().optional(),
});

// Client-side env vars (NEXT_PUBLIC_ prefix)
export const clientSchema = z.object({
    NEXT_PUBLIC_APP_URL: z.string().url(),
});
