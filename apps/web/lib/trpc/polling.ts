/**
 * Query options that keep a "Retrieving" surface current without a manual
 * refresh (#426).
 *
 * A restore takes hours, so this is not a progress bar — it is what stops the
 * row that flipped `ready` in the background from sitting stale until the user
 * reloads. Thirty seconds is chosen against the worker's fifteen-minute poll,
 * which is what actually observes the flip: anything faster only re-asks a
 * question whose answer cannot have changed, and anything slower makes the
 * transition feel broken to someone watching the page.
 *
 * Polling is conditional on purpose. A library with nothing in flight is the
 * normal state, and an unconditional interval would have every idle dashboard
 * tab querying forever.
 */
export const RETRIEVAL_POLL_INTERVAL_MS = 30_000;

export interface LivePollOptions {
    refetchInterval?: number;
    staleTime?: number;
}

/**
 * Spread into `queryOptions()` for a query that should follow an in-flight
 * restore, when something outside the query decides whether one is running.
 *
 * `staleTime: 0` only while polling: the query client's 60s default is right
 * for an idle page, but it would also swallow the window-focus refetch that
 * makes returning to the tab feel instant.
 */
export function getLivePollOptions(isActive: boolean): LivePollOptions {
    if (!isActive) return {};
    return { refetchInterval: RETRIEVAL_POLL_INTERVAL_MS, staleTime: 0 };
}

/**
 * The same thing for a query that can answer "am I still waiting?" from its own
 * data — the better shape where it applies, because the poll then stops on the
 * response that made it unnecessary rather than on a sibling query's timer.
 *
 * Returned as a `refetchInterval` callback rather than a number: react-query
 * re-evaluates it after every fetch, which is what makes the stop condition
 * self-terminating.
 */
export function getLivePollOptionsWhile<TData>(
    isActive: (data: TData | undefined) => boolean
): {
    refetchInterval: (query: {
        state: { data: TData | undefined };
    }) => number | false;
    staleTime: number;
} {
    return {
        refetchInterval: (query) =>
            isActive(query.state.data) ? RETRIEVAL_POLL_INTERVAL_MS : false,
        staleTime: 0,
    };
}
