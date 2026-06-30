import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { deleteUserByEmail } from '@nexus/db/test-db';

import { connect } from './db';
import { encodeGif, encodeMp4 } from './encode';
import { ASSETS_DIR, TMP_DIR } from './paths';
import { startRecording } from './recorder';
import type { Scene, SceneContext } from './scene';
import { seedDemoLibrary } from './seed';
import { ensureServer } from './server';
import { CAPTURE_USER, provisionCaptureUser } from './session';

/** CLI-level overrides; each falls back to the scene's own `output`, then a default. */
export interface RunOverrides {
    gif?: boolean;
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
    const wantGif = opts.overrides.gif ?? out.gif ?? true;
    const wantMp4 = opts.overrides.mp4 ?? out.mp4 ?? false;
    // Resolve outputs up front so a misconfigured run (e.g. `--no-gif` with no
    // `--mp4`) fails in under a second, not after a full server start + record.
    if (!wantGif && !wantMp4)
        throw new Error(
            'Nothing to encode: both GIF and MP4 are disabled (--no-gif without --mp4).'
        );

    const server = await ensureServer({ manage: opts.manageServer });
    const statePath = join(TMP_DIR, 'auth', `${scene.name}.json`);
    const videoDir = join(TMP_DIR, 'video', scene.name);
    const db = connect();

    try {
        console.log(`• ${scene.name}: provisioning capture user`);
        const user = await provisionCaptureUser(server.baseUrl, db, statePath);

        const ctx: SceneContext = {
            db,
            user,
            baseUrl: server.baseUrl,
            seedDemoLibrary: () => seedDemoLibrary(db, user),
        };

        console.log(`• ${scene.name}: preparing state`);
        const data = await scene.setup(ctx);

        console.log(`• ${scene.name}: recording`);
        const rec = await startRecording({
            baseUrl: server.baseUrl,
            storageStatePath: statePath,
            videoDir,
            viewport: scene.viewport ?? DEFAULT_VIEWPORT,
        });
        await scene.record(rec.stage, data);
        const { videoPath, trimStart } = await rec.finish();

        const basename = out.name ?? scene.name;
        const speed = opts.overrides.speed ?? out.speed ?? 1;

        const written: string[] = [];
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
        if (wantMp4) {
            const dest = join(ASSETS_DIR, `${basename}.mp4`);
            console.log(`• ${scene.name}: encoding MP4`);
            encodeMp4(videoPath, dest, {
                trimStart,
                speed,
                width: opts.overrides.width ?? out.width ?? 1000,
                fps: opts.overrides.fps ?? out.fps ?? 15,
            });
            written.push(dest);
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
