import {
    MutationObserver,
    type MutationOptions,
    type QueryClient,
} from '@tanstack/react-query';

/**
 * Mutations run the way `useMutation` runs them, for code outside React (the
 * upload session, #399): the options' retries and tRPC toast context apply,
 * and the QueryClient's MutationCache logs and reports a failure.
 */

/**
 * `useMutation(options).mutateAsync`, without the component. One observer,
 * shared by every call, the way one `useMutation` is: each call still runs as
 * a mutation of its own and resolves with its own result.
 */
export function createMutateFn<TData, TError, TVariables, TContext>(
    queryClient: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>
): (input: TVariables) => Promise<TData> {
    const observer = new MutationObserver(queryClient, options);
    return (input) => observer.mutate(input);
}

/**
 * `useMutation(options).mutate`: nobody awaits it, so a failure is swallowed
 * here rather than left as an unhandled rejection, which would reach Sentry a
 * second time on top of the MutationCache's report. Each call sits in
 * `inFlight` until it settles, for a caller that has to wait for them.
 */
export function createFireAndForgetFn<TData, TError, TVariables, TContext>(
    queryClient: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>,
    inFlight: Set<Promise<unknown>>
): (input: TVariables) => void {
    const mutate = createMutateFn(queryClient, options);
    return (input) => {
        const call = mutate(input).catch(() => {});
        inFlight.add(call);
        void call.finally(() => inFlight.delete(call));
    };
}
