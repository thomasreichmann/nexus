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
    /** Encoder quality 1-100: gifski's for a GIF (default 80), img2webp's for a WebP (default 75). */
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
 * Extract the trimmed, sped-up, downscaled clip as PNG frames, hand their
 * sorted paths to `encode`, and clean up. Both animated encoders take frames,
 * not video.
 */
function withFrames(
    input: string,
    o: EncodeOptions,
    encode: (pngs: string[]) => void
): void {
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
        encode(pngs);
    } finally {
        rmSync(frames, { recursive: true, force: true });
    }
}

/**
 * GIF via gifski. The naive `ffmpeg in out.gif` lands at multiple megabytes;
 * gifski beats ffmpeg's palettegen on quality-per-byte. GIF is still capped
 * at 256 colours a frame, which bands and dithers photos badly, so the README
 * walkthrough uses animated WebP instead (`encodeWebp`).
 */
export function encodeGif(
    input: string,
    output: string,
    o: EncodeOptions
): void {
    ensure('ffmpeg', 'Install it (macOS: brew install ffmpeg), then re-run.');
    ensure('gifski', 'Install it (macOS: brew install gifski), then re-run.');
    mkdirSync(dirname(output), { recursive: true });
    withFrames(input, o, (pngs) =>
        run('gifski', [
            '--fps',
            String(o.fps),
            '--quality',
            String(o.quality ?? 80),
            '-o',
            output,
            ...pngs,
        ])
    );
}

/**
 * Animated WebP via img2webp. Autoplays and loops in an <img> like a GIF
 * (GitHub doesn't autoplay <video> in a README), but each frame is real lossy
 * (or, where smaller, lossless) compression rather than a 256-colour palette:
 * for the same bytes as a q60 GIF at 760px it carries a 1000px clip with
 * clean photos and text. `-mixed` picks lossy or lossless per frame, so flat
 * UI frames stay crisp.
 */
export function encodeWebp(
    input: string,
    output: string,
    o: EncodeOptions
): void {
    ensure('ffmpeg', 'Install it (macOS: brew install ffmpeg), then re-run.');
    ensure('img2webp', 'Install it (macOS: brew install webp), then re-run.');
    mkdirSync(dirname(output), { recursive: true });
    withFrames(input, o, (pngs) =>
        run('img2webp', [
            '-loop',
            '0',
            '-lossy',
            '-q',
            String(o.quality ?? 75),
            '-m',
            '6',
            '-mixed',
            '-d',
            String(Math.round(1000 / o.fps)),
            ...pngs,
            '-o',
            output,
        ])
    );
}

/** H.264 MP4 (yuv420p, faststart). Kept as the source of truth beside the README's animated image. */
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
