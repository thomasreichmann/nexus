import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tooling/capture/src/paths.ts -> the repo root is three directories up.
const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, '../../..');

/** Where finished GIF / MP4 files land; the README references this dir. */
export const ASSETS_DIR = resolve(REPO_ROOT, '.github/assets');

/** Scratch for raw video, extracted frames, palettes, and saved auth state (git-ignored). */
export const TMP_DIR = resolve(here, '..', '.tmp');

/**
 * The web app's env file. Holds DATABASE_URL (and is what drizzle, the seed CLI,
 * and the e2e suite all read). Pulled with `pnpm env:pull`, never committed.
 */
export const WEB_ENV = resolve(REPO_ROOT, 'apps/web/.env.local');
