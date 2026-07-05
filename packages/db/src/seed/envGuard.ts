export type SeedEnvCheck = { isOk: true } | { isOk: false; message: string };

/**
 * Fail-closed environment guard for the seed CLI.
 *
 * The seed CLI mutates whatever database DATABASE_URL points at, so it
 * refuses to run unless DB_ENV explicitly marks the environment as
 * non-production. Missing DB_ENV refuses (fail-closed) rather than assuming
 * dev — see docs/guides/environment-setup.md.
 */
export function checkSeedEnv(dbEnv: string | undefined): SeedEnvCheck {
    const normalized = dbEnv?.trim().toLowerCase();

    if (!normalized) {
        return {
            isOk: false,
            message:
                'DB_ENV is not set. The seed CLI refuses to run without an explicit ' +
                'environment marker.\n' +
                'Set DB_ENV=development in apps/web/.env.local to seed the dev database.',
        };
    }

    if (normalized === 'production') {
        return {
            isOk: false,
            message:
                'DB_ENV=production — refusing to seed a production database. ' +
                'Seed data must never be written to prod.',
        };
    }

    return { isOk: true };
}
