import type { Page, Request } from '@playwright/test';

/**
 * True when a tRPC request URL targets the given procedure.
 *
 * The client uses httpBatchLink, which can merge same-tick calls into
 * `/api/trpc/<procA>,<procB>?batch=1` — so the procedure must be matched as
 * a full comma-separated path segment. A substring check would let
 * `admin.jobs` match `admin.jobs.counts`; an end-anchored regex would miss a
 * batched procedure in first position.
 */
export function isTrpcRequest(url: string, procedure: string): boolean {
    const path = /\/api\/trpc\/([^?]+)/.exec(url);
    return path !== null && path[1].split(',').includes(procedure);
}

/**
 * Intercepts a tRPC procedure, records each call's POST body, and aborts the
 * request so it never reaches the server (no DB rows, no S3/Stripe calls).
 * Returns the array the recorded bodies land in — assert with
 * `expect.poll(() => calls.length)`.
 *
 * Aborting a batched request would abort every procedure in the batch; fine
 * for the mutations tested this way, which fire alone in their tick.
 */
export async function interceptTrpcCalls(
    page: Page,
    procedure: string
): Promise<string[]> {
    const calls: string[] = [];
    await page.route(
        (url) => isTrpcRequest(url.href, procedure),
        (route) => {
            calls.push(route.request().postData() ?? '');
            return route.abort();
        }
    );
    return calls;
}

/**
 * Resolves with the next request to the given tRPC procedure. Start the wait
 * BEFORE the interaction that should trigger it:
 *
 *     const refetch = waitForTrpcRequest(page, 'admin.jobs.list');
 *     await page.getByRole('button', { name: 'Refresh' }).click();
 *     await refetch;
 */
export function waitForTrpcRequest(
    page: Page,
    procedure: string
): Promise<Request> {
    return page.waitForRequest((req) => isTrpcRequest(req.url(), procedure));
}
