import { resolve } from 'node:path';
import { config } from 'dotenv';

// Anchored to this file, not the cwd: `pnpm mutate` runs every tier from the
// repo root (#494).
config({ path: resolve(import.meta.dirname, '.env.local'), quiet: true });
