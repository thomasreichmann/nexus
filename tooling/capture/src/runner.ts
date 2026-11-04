import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { deleteUserByEmail } from '@nexus/db/test-db';

import { connect } from './db';
import { encodeGif, encodeMp4, encodeWebp } from './encode';
import { ASSETS_DIR, TMP_DIR } from './paths';
import { startRecording } from './recorder';
import { seedDemoLibrary } from './seed';
import { ensureServer } from './server';
import { CAPTURE_USER, provisionCaptureUser } from './session';
import type { Scene, SceneContext } from './scene';

/** CLI-level overrides; each falls back to the scene's own `output`, then a default. */
export interface RunOverrides {
    gif?: boolean;
    webp?: boolean;
    mp4?: boolean;
    width?: number;
    fps?: number;
    speed?: number;
    quality?: number;
}

export interface RunOptions {
    manageServer: boolean;
    keepVideo: boolean;
    overrides: RunOverrides;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** Run one scene end to end — server, sign-in, seed, record, encode — and return the files written. */
export async function runScene(
    scene: Scene,
    opts: RunOptions
): Promise<string[]> {
    const out = scene.output ?? {};
    const isStill = out.still ?? false;
    const wantGif = opts.overrides.gif ?? out.gif ?? !isStill;
    const wantWebp = opts.overrides.webp ?? out.webp ?? false;
    const wantMp4 = opts.overrides.mp4 ?? out.mp4 ?? false;
    const wantVideo = wantGif || wantWebp || wantMp4;
    // Resolve outputs up front so a misconfigured run (e.g. `--no-gif` with
    // nothing else on) fails in under a second, not after a full server start
    // + record.
    if (!wantVideo && !isStill)
        throw new Error(
            'Nothing to encode: GIF, WebP and MP4 are all disabled.'
        );

    const server = await ensureServer({ manage: opts.manageServer });
    const statePath = join(TMP_DIR, 'auth', `${scene.name}.json`);
    const videoDir = join(TMP_DIR, 'video', scene.name);
    const db = connect();
    // Filled by the seed (fileId -> local WebP), read by the recorder's route.
    const thumbnails = new Map<string, string>();

    try {
        console.log(`• ${scene.name}: provisioning capture user`);
        const user = await provisionCaptureUser(server.baseUrl, db, statePath);

        const ctx: SceneContext = {
            db,
            user,
            baseUrl: server.baseUrl,
            seedDemoLibrary: () => seedDemoLibrary(db, user, thumbnails),
        };

        console.log(`• ${scene.name}: preparing state`);
        const data = await scene.setup(ctx);

        console.log(
            `• ${scene.name}: ${wantVideo ? 'recording' : 'capturing'}`
        );
        const rec = await startRecording({
            baseUrl: server.baseUrl,
            storageStatePath: statePath,
            videoDir: wantVideo ? videoDir : undefined,
            viewport: scene.viewport ?? DEFAULT_VIEWPORT,
            thumbnails,
        });
        await scene.record(rec.stage, data);
        const { video } = await rec.finish();

        const written: string[] = [...rec.stage.stills];
        if (isStill && written.length === 0)
            throw new Error(
                `${scene.name} is a still scene but wrote no stills (call stage.still()).`
            );
        if (!video) return written;
        const { path: videoPath, trimStart } = video;

        const basename = out.name ?? scene.name;
        const speed = opts.overrides.speed ?? out.speed ?? 1;

        if (wantGif) {
            const dest = join(ASSETS_DIR, `${basename}.gif`);
            console.log(
                `• ${scene.name}: encoding GIF (trim ${trimStart.toFixed(1)}s)`
            );
            encodeGif(videoPath, dest, {
                trimStart,
                speed,
                width: opts.overrides.width ?? out.gifWidth ?? 760,
                fps: opts.overrides.fps ?? out.gifFps ?? 12,
                quality: opts.overrides.quality ?? out.quality,
            });
            written.push(dest);
        }
        const width = opts.overrides.width ?? out.width ?? 1000;
        const fps = opts.overrides.fps ?? out.fps ?? 15;
        // The WebP is built from the MP4, not the raw recording: H.264 smooths
        // Playwright's noisy VP8 capture, which the WebP encoder would
        // otherwise spend bytes on (q75 measured 1.6MB from the raw frames,
        // 850KB from the MP4, with no visible difference). Without --mp4 the
        // MP4 is an intermediate in the scratch dir.
        if (wantMp4 || wantWebp) {
            const mp4 = wantMp4
                ? join(ASSETS_DIR, `${basename}.mp4`)
                : join(videoDir, 'intermediate.mp4');
            console.log(
                `• ${scene.name}: encoding MP4 (trim ${trimStart.toFixed(1)}s)`
            );
            encodeMp4(videoPath, mp4, { trimStart, speed, width, fps });
            if (wantMp4) written.push(mp4);

            if (wantWebp) {
                const dest = join(ASSETS_DIR, `${basename}.webp`);
                console.log(`• ${scene.name}: encoding WebP`);
                // Already trimmed, sped up and scaled: pass it through as is.
                encodeWebp(mp4, dest, {
                    trimStart: 0,
                    speed: 1,
                    width,
                    fps,
                    quality: opts.overrides.quality ?? out.webpQuality,
                });
                written.push(dest);
            }
        }

        if (!opts.keepVideo) rmSync(videoDir, { recursive: true, force: true });
        return written;
    } finally {
        // Tear down the dedicated capture user (cascades its data), the saved
        // session (live cookies — never leave it lying around), and the server.
        await deleteUserByEmail(db, CAPTURE_USER.email).catch(() => {});
        await db.$client.end({ timeout: 5 }).catch(() => {});
        rmSync(statePath, { force: true });
        await server.stop();
    }
}
