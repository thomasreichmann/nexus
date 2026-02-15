import { z } from 'zod';

export const logErrorVerbositySchema = z.enum(['minimal', 'standard', 'full']);

// Server-side env vars (not exposed to client)
export const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    SQS_QUEUE_URL: z.string().url(),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    LOG_ERROR_VERBOSITY: logErrorVerbositySchema.optional(),
});

// Client-side env vars (NEXT_PUBLIC_ prefix)
export const clientSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
});
