import { config } from 'dotenv';
// Dev-only tool: the web app's .env.local is the single env source for all
// local tooling (drizzle, seed CLI, capture, e2e). Deployed code never uses
// this path — see docs/guides/environment-setup.md.
// quiet: keep the load notice out of drizzle-kit's output, where it otherwise
// sits next to the target banner db:migrate prints.
config({ path: '../../apps/web/.env.local', quiet: true });
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/schema/index.ts',
    out: './src/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
