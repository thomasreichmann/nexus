/**
 * The Resend client, and the credentials it needs read straight from
 * `process.env`.
 *
 * Not through a validated env module because this package has two runtimes
 * with two different ones: apps/web validates a Zod schema that would demand a
 * full `.env.local` from every importer (including a test that only renders a
 * template), and the worker Lambda has no schema at all — its environment is
 * set by Terraform (`infra/terraform/lambda.tf`). Each runtime validates its
 * own environment; `requireEnv` below is the shared backstop.
 */
import { Resend } from 'resend';

type EmailEnvVar = 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL';

function requireEnv(name: EmailEnvVar): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. Configure it in the app's env (apps/web/lib/env/schema.ts) or on the worker Lambda (infra/terraform/lambda.tf).`
        );
    }
    return value;
}

// Lazy: constructing at module scope would make importing any template — or
// the mock in ./testing — require a Resend key.
let client: Resend | undefined;

export function getResendClient(): Resend {
    client ??= new Resend(requireEnv('RESEND_API_KEY'));
    return client;
}

export function getFromEmail(): string {
    return requireEnv('RESEND_FROM_EMAIL');
}
