import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';

import { Stage } from './stage';

export interface RecorderOptions {
    baseUrl: string;
    storageStatePath: string;
    videoDir: string;
    viewport: { width: number; height: number };
}

export interface Recording {
    stage: Stage;
    /** Stop recording; return the raw .webm path plus how many seconds of head to trim. */
    finish: () => Promise<{ videoPath: string; trimStart: number }>;
}

export async function startRecording(
    opts: RecorderOptions
): Promise<Recording> {
    mkdirSync(opts.videoDir, { recursive: true });

    const browser: Browser = await chromium.launch();
    const context: BrowserContext = await browser.newContext({
        viewport: opts.viewport,
        colorScheme: 'dark',
        // Render at 2x for crisp text, then downscale at encode time.
        deviceScaleFactor: 2,
        storageState: opts.storageStatePath,
        recordVideo: { dir: opts.videoDir, size: opts.viewport },
    });
    // Anchor the action clock to page creation, where Playwright starts the
    // video, so a trimmed offset lines up with the video's t=0.
    const page = await context.newPage();
    const startedAt = Date.now();
    const stage = new Stage(page, opts.baseUrl, startedAt);

    return {
        stage,
        finish: async () => {
            const video = page.video();
            const offset = stage.firstActionOffset;
            // Open the clip ~0.8s before the first action so it starts on the
            // loaded, idle UI; clamp so a fast warm start can't go negative.
            const trimStart = offset === null ? 0 : Math.max(0, offset - 0.8);
            // The video file isn't finalized until the context closes.
            await context.close();
            await browser.close();
            if (!video)
                throw new Error(
                    'No video was recorded (recordVideo not active?).'
                );
            const videoPath = await video.path();
            return { videoPath, trimStart };
        },
    };
}
