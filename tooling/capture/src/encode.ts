import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface EncodeOptions {
    /** Seconds of head to drop (passed as ffmpeg -ss before the input). */
    trimStart: number;
    /** Output width in px; height keeps aspect (rounded to even for codec safety). */
    width: number;
    fps: number;
    /** Playback speed multiplier (1 = unchanged). */
    speed: number;
    /** gifski quality 1-100 (default 80; the sweet spot for this flat dark UI). */
    quality?: number;
}

function ensure(bin: string, hint: string): void {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    if (probe.error) throw new Error(`${bin} not found. ${hint}`);
}

function run(bin: string, args: string[]): void {
    const res = spawnSync(bin, args, {
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (res.status !== 0)
        throw new Error(`${bin} failed (exit ${res.status ?? 'unknown'}).`);
}

/** optional speedup, frame rate, lanczos downscale to an even-height width. */
function videoFilter(o: EncodeOptions): string {
    const speedup =
        o.speed !== 1 ? `setpts=${(1 / o.speed).toFixed(4)}*PTS,` : '';
    return `${speedup}fps=${o.fps},scale=${o.width}:-2:flags=lanczos`;
}

/**
 * GIF via gifski. A GIF has to be a GIF on a README (GitHub doesn't autoplay
 * <video>), but the naive `ffmpeg in out.gif` lands at multiple megabytes —
 * GIF stores near-whole frames at 256 colours, where H.264 only stores deltas.
 * gifski is a purpose-built encoder that beats ffmpeg's palettegen on
 * quality-per-byte; downsampling frames first (fps + width) and feeding them in
 * gets the README clip to well under a megabyte. ffmpeg extracts the frames,
 * gifski encodes them.
 */
export function encodeGif(
    input: string,
    output: string,
    o: EncodeOptions
): void {
    ensure('ffmpeg', 'Install it (macOS: brew install ffmpeg), then re-run.');
    ensure('gifski', 'Install it (macOS: brew install gifski), then re-run.');
    mkdirSync(dirname(output), { recursive: true });

    const frames = mkdtempSync(join(dirname(input), 'frames-'));
    try {
        run('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            '-ss',
            String(o.trimStart),
            '-i',
            input,
            '-vf',
            videoFilter(o),
            join(frames, 'f%05d.png'),
        ]);

        // spawnSync doesn't expand globs, so pass the frame files explicitly, sorted.
        const pngs = readdirSync(frames)
            .filter((f) => f.endsWith('.png'))
            .sort()
            .map((f) => join(frames, f));
        if (pngs.length === 0)
            throw new Error(
                'No frames extracted (is the clip empty after trim?).'
            );

        run('gifski', [
            '--fps',
            String(o.fps),
            '--quality',
            String(o.quality ?? 80),
            '-o',
            output,
            ...pngs,
        ]);
    } finally {
        rmSync(frames, { recursive: true, force: true });
    }
}

/** H.264 MP4 (yuv420p, faststart). Kept as the source of truth the GIF is re-encoded from. */
export function encodeMp4(
    input: string,
    output: string,
    o: EncodeOptions
): void {
    ensure('ffmpeg', 'Install it (macOS: brew install ffmpeg), then re-run.');
    mkdirSync(dirname(output), { recursive: true });
    run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostats',
        '-y',
        '-ss',
        String(o.trimStart),
        '-i',
        input,
        '-vf',
        `${videoFilter(o)},format=yuv420p`,
        '-c:v',
        'libx264',
        '-crf',
        '23',
        '-preset',
        'veryfast',
        '-movflags',
        '+faststart',
        '-an',
        output,
    ]);
}
