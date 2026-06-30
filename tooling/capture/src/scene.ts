import type { Db } from './db';
import type { Stage } from './stage';

/** The dedicated, throwaway user a recording is driven as. */
export interface CaptureUser {
    id: string;
    email: string;
}

/** What a scene's `setup` receives: a DB handle, the capture user, the base URL, and the demo-library seeder. */
export interface SceneContext {
    db: Db;
    user: CaptureUser;
    baseUrl: string;
    /** Seed the curated demo library (shoots, files, retrievals) onto the capture user. */
    seedDemoLibrary: () => Promise<void>;
}

export interface OutputOptions {
    /** Encode a GIF (default true). */
    gif?: boolean;
    /** Also encode an MP4 (default false) — the source of truth the GIF is re-encoded from. */
    mp4?: boolean;
    /** Output basename, written to .github/assets/<name>.{gif,mp4}. Defaults to the scene name. */
    name?: string;
    /** MP4 width in px; height follows aspect (default 1000). */
    width?: number;
    /** MP4 frames per second (default 15). */
    fps?: number;
    /**
     * GIF width in px (default 760). Kept smaller than the MP4 on purpose: a GIF
     * has no interframe compression, so trimming resolution is the cheapest way
     * to keep the README clip light. Height follows aspect.
     */
    gifWidth?: number;
    /** GIF frames per second (default 12). */
    gifFps?: number;
    /** Playback speed multiplier (default 1; >1 plays faster). */
    speed?: number;
    /** gifski quality 1-100 (default 80). */
    quality?: number;
}

/** The authored shape of a scene; `T` is whatever `setup` returns and `record` consumes. */
export interface SceneDefinition<T> {
    name: string;
    description: string;
    viewport?: { width: number; height: number };
    output?: OutputOptions;
    /** Prepare state before recording (e.g. seed data). Runs before the browser opens, so its time is never in the video. */
    setup?: (ctx: SceneContext) => Promise<T>;
    /** Drive the scripted interaction. The load + first settle is auto-trimmed up to just before the first action. */
    record: (stage: Stage, data: T) => Promise<void>;
}

/** The type-erased scene the registry and runner pass around. */
export interface Scene {
    name: string;
    description: string;
    viewport?: { width: number; height: number };
    output?: OutputOptions;
    setup: (ctx: SceneContext) => Promise<unknown>;
    record: (stage: Stage, data: unknown) => Promise<void>;
}

export function defineScene<T>(def: SceneDefinition<T>): Scene {
    // The name becomes a filename and path segment; keep it kebab-case so it can
    // never escape its directory.
    if (!/^[a-z0-9-]+$/.test(def.name)) {
        throw new Error(
            `Scene name must be kebab-case [a-z0-9-]; got "${def.name}".`
        );
    }
    return {
        name: def.name,
        description: def.description,
        viewport: def.viewport,
        output: def.output,
        setup: def.setup ?? (async (): Promise<T> => undefined as T),
        record: (stage, data) => def.record(stage, data as T),
    };
}
