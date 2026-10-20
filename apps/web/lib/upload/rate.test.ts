import { describe, expect, it } from 'vitest';
import {
    createRateMeter,
    describeTimeLeft,
    MIN_SIGNAL_MS,
    RATE_WINDOW_MS,
} from './rate';

const MB = 1_000_000;

/** A meter fed `bytesPerSecond` once a second for `seconds` seconds. */
function steadyMeter(bytesPerSecond: number, seconds: number) {
    const meter = createRateMeter();
    for (let s = 0; s <= seconds; s++)
        meter.record(s * 1000, s * bytesPerSecond);
    return meter;
}

describe('createRateMeter', () => {
    it('stays hidden until it has enough history to be honest', () => {
        const meter = steadyMeter(MB, 4);

        expect(meter.estimate(MIN_SIGNAL_MS - 1, 100 * MB)).toBeNull();
        expect(meter.estimate(MIN_SIGNAL_MS, 100 * MB)).not.toBeNull();
    });

    it('measures bytes over the window, and the time left at that rate', () => {
        const meter = steadyMeter(2 * MB, 60);

        expect(meter.estimate(60_000, 120 * MB)).toEqual({
            bytesPerSecond: 2 * MB,
            secondsLeft: 60,
        });
    });

    // Small files landing in bursts and one large file trickling in are the
    // same uplink: the window averages a burst, rather than reading it as a
    // spike and the gap after it as a stall.
    it('reads bursts as the rate across them', () => {
        const meter = createRateMeter();
        // 10 MB lands every 5 s, all at once.
        for (let s = 0; s <= 30; s += 5)
            meter.record(s * 1000, (s / 5) * 10 * MB);

        const estimate = meter.estimate(30_000, 0)!;

        expect(estimate.bytesPerSecond).toBe(2 * MB);
    });

    it('forgets what fell out of the window', () => {
        const meter = createRateMeter();
        // Fast for a minute, then slow for a window's length.
        for (let s = 0; s <= 60; s++) meter.record(s * 1000, s * 10 * MB);
        const fastBytes = 600 * MB;
        const windowSeconds = RATE_WINDOW_MS / 1000;
        for (let s = 1; s <= windowSeconds; s++) {
            meter.record((60 + s) * 1000, fastBytes + s * MB);
        }

        expect(
            meter.estimate((60 + windowSeconds) * 1000, 0)?.bytesPerSecond
        ).toBe(MB);
    });

    it('slows with a stall, and goes quiet once the stall outlasts the window', () => {
        const meter = steadyMeter(MB, 30);

        // The 20 MB sent from 10 s to 30 s, over the 30 s up to now.
        expect(meter.estimate(40_000, 0)?.bytesPerSecond).toBeCloseTo(
            (20 * MB) / 30
        );
        expect(meter.estimate(30_000 + RATE_WINDOW_MS + 1, 0)).toBeNull();
    });

    it('starts over when bytes go backwards, and waits for history again', () => {
        const meter = steadyMeter(MB, 30);

        // A failed part backs its bytes out, and sending carries on.
        meter.record(31_000, 20 * MB);
        meter.record(33_000, 22 * MB);

        expect(meter.estimate(33_000, 0)).toBeNull();
        meter.record(36_000, 25 * MB);
        expect(meter.estimate(36_000, 0)?.bytesPerSecond).toBe(MB);
    });

    // Bytes keep rising across the reset, so only the reset can start over.
    it('forgets a finished wave on reset', () => {
        const meter = steadyMeter(MB, 30);

        meter.reset();
        meter.record(100_000, 30 * MB);
        meter.record(102_000, 32 * MB);

        expect(meter.estimate(102_000, MB)).toBeNull();
    });
});

describe('describeTimeLeft', () => {
    it('speaks in coarse steps', () => {
        expect(describeTimeLeft(20)).toBe('less than a minute left');
        expect(describeTimeLeft(29)).toBe('less than a minute left');
        expect(describeTimeLeft(60)).toBe('about 1 min left');
        expect(describeTimeLeft(90)).toBe('about 2 min left');
        expect(describeTimeLeft(59 * 60)).toBe('about 59 min left');
        expect(describeTimeLeft(60 * 60)).toBe('about 1 h left');
        expect(describeTimeLeft(80 * 60)).toBe('about 1 h 20 min left');
    });
});
