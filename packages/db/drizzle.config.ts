import { config } from 'dotenv';
config({ path: '../../apps/web/.env.local' });
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/schema/index.ts',
    out: './src/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
