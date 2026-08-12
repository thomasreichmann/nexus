import { z } from 'zod';

export const logErrorVerbositySchema = z.enum(['minimal', 'standard', 'full']);

// Server-side env vars (not exposed to client)
export const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    // Derived (thumbnails) bucket. Optional so deploys don't break between
    // this code landing and `terraform apply` creating the bucket — unset
    // degrades thumbnails to icon fallbacks (bulk presign returns no URLs).
    S3_DERIVED_BUCKET: z.string().min(1).optional(),
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
    // Deployed Vercel envs only (production/preview tiers). Presence is half
    // the gate that turns Sentry on — the other half is a deployment signal
    // (VERCEL server-side, NEXT_PUBLIC_VERCEL_ENV client-side) — so local
    // dev, CI, and e2e builds leave it unset. See instrumentation-client.ts.
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    // Same deployment gate as the Sentry DSN above, for the same reason. Not
    // .url() — a PostHog project key is an opaque `phc_...` string.
    NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    // Ingestion host. Unset falls back to DEFAULT_POSTHOG_HOST (US cloud);
    // set it to point at the EU region. lib/posthog/hosts.ts derives the
    // asset and dashboard hosts from this by substring, which only holds for
    // PostHog cloud — a self-hosted origin passes through unrewritten.
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
});
