import { randomBytes } from 'node:crypto';

/**
 * One id per `playwright test` invocation, used to give the run its own users
 * and auth-state files (#484). Every run shares the dev DB, so with fixed
 * identities two overlapping runs reset and deleted each other's users
 * mid-test.
 *
 * Same handoff as E2E_PORT (`server-url.ts`): the Playwright main process picks
 * it while evaluating the config and publishes it on E2E_RUN_ID; the workers
 * inherit that env var and re-read it here, so every process agrees. An
 * E2E_RUN_ID you export yourself wins, which also means two runs given the
 * same one share users again.
 */
function resolveRunId(): string {
    const existing = process.env.E2E_RUN_ID;
    if (existing) return existing;
    const runId = randomBytes(4).toString('hex');
    process.env.E2E_RUN_ID = runId;
    return runId;
}

export const E2E_RUN_ID = resolveRunId();

/** This run's auth-state files; the teardown project removes the folder. */
export const RUN_AUTH_DIR = `e2e/.auth/run-${E2E_RUN_ID}`;

export function runStatePath(name: string): string {
    return `${RUN_AUTH_DIR}/${name}.json`;
}
