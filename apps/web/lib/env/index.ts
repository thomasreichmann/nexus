import { clientSchema, serverSchema } from '@/lib/env/schema';
import z from 'zod';

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;
type Env = ServerEnv & ClientEnv;

function formatEnvError(
    error: z.ZodError,
    context: 'client' | 'server',
    allMissing: boolean
): never {
    if (allMissing) {
        const message = `
❌ No ${context} environment variables found.

Missing .env.local? Run \`pnpm env:pull\` to fetch from Vercel.
For new worktrees, copy .env.local from your main worktree.
`;
        console.error(message);
        throw new Error(`No ${context} environment variables found`);
    }

    const vars = error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
    const message = `
❌ Invalid ${context} environment variables:
${vars}

Run \`pnpm env:pull\` to fetch from Vercel.
`;
    console.error(message);
    throw new Error(`Invalid ${context} environment variables`);
}

// Client vars validated at build time (inlined by Next.js)
const clientKeys = Object.keys(clientSchema.shape);
const rawClientEnv = Object.fromEntries(
    clientKeys.map((key) => [key, process.env[key]])
);
const clientResult = clientSchema.safeParse(rawClientEnv);
const allClientMissing = Object.values(rawClientEnv).every((v) => v === undefined);
const clientEnv = clientResult.success
    ? clientResult.data
    : formatEnvError(clientResult.error, 'client', allClientMissing);

// Server vars validated lazily at runtime (not available during build)
let serverEnv: ServerEnv | null = null;
const serverKeys = new Set(Object.keys(serverSchema.shape));

export const env = new Proxy(clientEnv as Env, {
    get(target, prop: string) {
        if (serverKeys.has(prop)) {
            if (!serverEnv) {
                const result = serverSchema.safeParse(process.env);
                const allServerMissing = [...serverKeys].every(
                    (k) => process.env[k] === undefined
                );
                serverEnv = result.success
                    ? result.data
                    : formatEnvError(result.error, 'server', allServerMissing);
            }
            return serverEnv[prop as keyof ServerEnv];
        }
        return target[prop as keyof ClientEnv];
    },
});
