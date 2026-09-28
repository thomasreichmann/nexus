import { resolve } from 'node:path';
import { config } from 'dotenv';

// The web app's .env.local is the single env source for local tooling
// (docs/guides/environment-setup.md). An exported DATABASE_URL wins, which is
// how CI and `pnpm test:integration:fresh` point the tier elsewhere.
config({
    path: resolve(import.meta.dirname, '../../apps/web/.env.local'),
    quiet: true,
});
