/**
 * A wave's transfer rate and time left (#407). A 59 GB backlog is a
 * multi-evening job, and a file count and a percent don't say how long one
 * evening's wave will take.
 *
 * Bytes, never files, and over a window rather than per tick: a run of small
 * files and one large video then read as the same uplink, and the estimate
 * doesn't jump each time a file lands. It stays hidden until the window has
 * enough history to be honest about.
 */

/** How far back the rate looks. */
export const RATE_WINDOW_MS = 30_000;
/** How much history the estimate waits for before showing anything. */
export const MIN_SIGNAL_MS = 5_000;
// Samples closer together than this replace each other: a file's XHR reports
// progress per network buffer, and the window only needs a few per second.
const SAMPLE_SPACING_MS = 250;

export interface WaveEstimate {
    bytesPerSecond: number;
    secondsLeft: number;
}

export interface RateMeter {
    /** Notes how many of the wave's bytes have been sent, at time `at`. */
    record(at: number, doneBytes: number): void;
    /** Forgets everything: a new wave. */
    reset(): void;
    /** The rate over the window ending at `at`, or null without enough history. */
    estimate(at: number, remainingBytes: number): WaveEstimate | null;
}

interface Sample {
    at: number;
    bytes: number;
}

export function createRateMeter(): RateMeter {
    let samples: Sample[] = [];
    let since: number | null = null;

    return {
        record(at, doneBytes) {
            const last = samples.at(-1);
            // Bytes going backwards (a failed part backing out, a cancelled
            // row, a retry starting over) make the history meaningless as a
            // rate, so the window starts again from here.
            if (last && doneBytes < last.bytes) {
                samples = [];
                since = at;
            }
            since ??= at;

            const previous = samples.at(-1);
            if (previous && at - previous.at < SAMPLE_SPACING_MS) {
                samples[samples.length - 1] = {
                    at: previous.at,
                    bytes: doneBytes,
                };
            } else {
                samples.push({ at, bytes: doneBytes });
            }
            const windowStart = at - RATE_WINDOW_MS;
            while (samples.length > 1 && samples[0]!.at < windowStart) {
                samples.shift();
            }
        },

        reset() {
            samples = [];
            since = null;
        },

        estimate(at, remainingBytes) {
            if (since === null || at - since < MIN_SIGNAL_MS) return null;
            const latest = samples.at(-1);
            if (!latest) return null;
            // From the oldest sample still in the window to now, not to the
            // newest sample: a stall then drags the rate down, and one longer
            // than the window leaves nothing to measure.
            const anchor =
                samples.find((sample) => sample.at >= at - RATE_WINDOW_MS) ??
                latest;
            const moved = latest.bytes - anchor.bytes;
            const seconds = (at - anchor.at) / 1000;
            if (moved <= 0 || seconds <= 0) return null;
            const bytesPerSecond = moved / seconds;
            return {
                bytesPerSecond,
                secondsLeft: remainingBytes / bytesPerSecond,
            };
        },
    };
}

/** "about 12 min left", in the coarse steps an estimate deserves. */
export function describeTimeLeft(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 1) return 'less than a minute left';
    if (minutes < 60) return `about ${minutes} min left`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (rest === 0) return `about ${hours} h left`;
    return `about ${hours} h ${rest} min left`;
}
