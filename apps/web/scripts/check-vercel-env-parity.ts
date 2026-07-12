/**
 * Asserts the three Vercel env tiers hold the same variable *keys* (#293).
 *
 * Values legitimately differ per tier (DATABASE_URL, S3_BUCKET, … — see
 * docs/guides/environment-setup.md), but every key should exist on all of
 * Production, Preview, and Development: a key present in one tier and
 * missing in another is exactly the drift that becomes a prod-only bug.
 * Fails (exit 1) on any key missing from a tier unless it's in
 * ASYMMETRY_ALLOWLIST.
 *
 * Requires VERCEL_TOKEN. Vercel tokens can't be scoped read-only — team-scope
 * it and give it an expiry (it can also write env vars, so handle it as a
 * real credential). VERCEL_PROJECT_ID / VERCEL_TEAM_ID default to nexus-web
 * (the values in .vercel/project.json; they identify, they don't
 * authenticate).
 *
 * Usage:
 *   VERCEL_TOKEN=... pnpm -F web check:vercel-env-parity
 */

import { alerts, getWorkflowRunUrl } from '@/lib/alerts';

const TIERS = ['production', 'preview', 'development'] as const;
type Tier = (typeof TIERS)[number];

// Keys allowed to exist in only some tiers, with the reason. Vars whose
// *values* differ per tier (DATABASE_URL, S3_BUCKET, …) don't belong here —
// their keys exist everywhere. Add entries when a tier legitimately gains a
// scoped key (e.g. a Production-only live-mode Stripe credential once #213
// lands).
const ASYMMETRY_ALLOWLIST: Record<string, string> = {
    // lib/env/schema.ts: unset disables the Discord alert transport, which
    // is the intended state for preview/dev runtimes; CI injects its own.
    DISCORD_ALERT_WEBHOOK_URL: 'prod-only by design',
    // Sentry is production+preview only: a key in the development tier would
    // flow into .env.local via env:pull and turn Sentry on for local/e2e
    // production builds (DSN) or make local builds attempt source-map upload
    // (auth token). See instrumentation-client.ts / next.config.ts.
    NEXT_PUBLIC_SENTRY_DSN: 'production+preview only by design',
    SENTRY_ORG: 'production+preview only by design',
    SENTRY_PROJECT: 'production+preview only by design',
    SENTRY_AUTH_TOKEN: 'production+preview only by design',
};

const DEFAULT_PROJECT_ID = 'prj_RuKjFko6iKwbyyIy55HYL5S5AabG';
const DEFAULT_TEAM_ID = 'team_piLBQY2ugwaz6UvqaNNCJebb';

interface VercelEnvVar {
    key: string;
    // The API returns an array; older payloads may use a bare string.
    target: Tier[] | Tier;
    gitBranch?: string;
}

async function fetchEnvVars(): Promise<VercelEnvVar[]> {
    const token = process.env.VERCEL_TOKEN;
    if (!token) {
        throw new Error(
            'VERCEL_TOKEN is not set — create a team-scoped token (with an expiry) at vercel.com/account/tokens'
        );
    }
    const projectId = process.env.VERCEL_PROJECT_ID ?? DEFAULT_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID ?? DEFAULT_TEAM_ID;

    const response = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Vercel API responded ${response.status}: ${body.slice(0, 300)}`
        );
    }
    const { envs } = (await response.json()) as { envs: VercelEnvVar[] };
    return envs;
}

function groupKeysByTier(envs: VercelEnvVar[]): Map<Tier, Set<string>> {
    const byTier = new Map<Tier, Set<string>>(
        TIERS.map((tier) => [tier, new Set<string>()])
    );
    for (const envVar of envs) {
        // A branch-scoped var only exists on that one branch's deploys, so
        // it can't make the key "present" for the tier in general — counting
        // it would mask a key missing from every other preview.
        if (envVar.gitBranch) continue;
        const targets = Array.isArray(envVar.target)
            ? envVar.target
            : [envVar.target];
        for (const target of targets) {
            byTier.get(target)?.add(envVar.key);
        }
    }
    return byTier;
}

async function main(): Promise<void> {
    const envs = await fetchEnvVars();
    const byTier = groupKeysByTier(envs);
    const allKeys = [...new Set(envs.map((envVar) => envVar.key))].sort();

    console.log(
        `Checking ${allKeys.length} distinct env keys across ${TIERS.length} Vercel tiers\n`
    );

    for (const envVar of envs.filter((e) => e.gitBranch)) {
        console.log(
            `  ~ ${envVar.key} (branch-scoped to '${envVar.gitBranch}') ignored for tier parity`
        );
    }

    const failures: string[] = [];
    for (const key of allKeys) {
        const missing = TIERS.filter((tier) => !byTier.get(tier)!.has(key));
        if (missing.length === 0) {
            console.log(`  ✓ ${key}`);
        } else if (key in ASYMMETRY_ALLOWLIST) {
            console.log(
                `  ~ ${key} missing in ${missing.join(', ')} (allowlisted: ${ASYMMETRY_ALLOWLIST[key]})`
            );
        } else {
            const present = TIERS.filter((tier) => !missing.includes(tier));
            failures.push(
                `${key} present in ${present.join(', ')}; missing in ${missing.join(', ')}`
            );
        }
    }

    for (const failure of failures) {
        console.log(`  ✗ ${failure}`);
    }

    if (failures.length > 0) {
        console.log(
            '\nCheck failed: Vercel env keys have drifted between tiers. If an asymmetry is intentional, add it to ASYMMETRY_ALLOWLIST in this script with the reason.'
        );
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            title: 'Vercel env-key drift detected between tiers',
            message: failures.join('\n'),
            context: {
                source: 'check-vercel-env-parity',
                ...(runUrl && { workflowRun: runUrl }),
            },
        });
    } else {
        console.log('\nAll checks passed.');
    }
}

main().catch((err) => {
    console.error('Vercel env parity check aborted:', err);
    process.exitCode = 1;
});
