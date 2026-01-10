import { clientSchema, serverSchema } from '@/lib/env/schema';
import z from 'zod';

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;
type Env = ServerEnv & ClientEnv;

// Client vars validated at build time (inlined by Next.js)
const clientKeys = Object.keys(clientSchema.shape);
const rawClientEnv = Object.fromEntries(
    clientKeys.map((key) => [key, process.env[key]])
); // as Record<keyof typeof clientSchema.shape, string>;
const clientEnv = clientSchema.parse(rawClientEnv);

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
