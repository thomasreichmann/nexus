import { z } from 'zod';

// Server-side env vars (not exposed to client)
const serverSchema = z.object({
    DATABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
});

// Client-side env vars (NEXT_PUBLIC_ prefix)
const clientSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;
type Env = ServerEnv & ClientEnv;

// Client vars validated at build time (inlined by Next.js)
const clientEnv = clientSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

// Server vars validated lazily at runtime (not available during build)
let serverEnv: ServerEnv | null = null;
const serverKeys = new Set(Object.keys(serverSchema.shape));

export const env = new Proxy(clientEnv as Env, {
    get(target, prop: string) {
        if (serverKeys.has(prop)) {
            if (!serverEnv) {
                serverEnv = serverSchema.parse(process.env);
            }
            return serverEnv[prop as keyof ServerEnv];
        }
        return target[prop as keyof ClientEnv];
    },
});
