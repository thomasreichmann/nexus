import { config } from 'dotenv';
config({ path: '../../apps/web/.env.local' });

import { createDb } from '../connection';
import {
    SCENARIO_DEFINITIONS,
    runScenario,
    cleanupAll,
    getSeedSummary,
} from './index';

const db = createDb(process.env.DATABASE_URL!);

const args = process.argv.slice(2);
const cleanFlag = args.includes('--clean');
const scenarioArg = args.find((a) => !a.startsWith('--'));

async function main() {
    if (cleanFlag) {
        console.log('Cleaning all seed data...');
        const result = await cleanupAll(db);
        console.log(
            `Cleaned: ${result.deletedUsers} users, ${result.deletedFiles} files, ` +
                `${result.deletedSubscriptions} subscriptions, ${result.deletedRetrievals} retrievals`
        );
        if (!scenarioArg) {
            process.exit(0);
        }
    }

    if (!scenarioArg) {
        // Show available scenarios and current summary
        const summary = await getSeedSummary(db);
        console.log('\nCurrent seed data:');
        console.log(`  Users: ${summary.users}`);
        console.log(`  Files: ${summary.files}`);
        console.log(`  Subscriptions: ${summary.subscriptions}`);
        console.log(`  Retrievals: ${summary.retrievals}`);
        console.log(`  Total bytes: ${formatBytes(summary.totalBytes)}`);

        console.log('\nAvailable scenarios:');
        for (const [key, def] of Object.entries(SCENARIO_DEFINITIONS)) {
            console.log(`  ${key.padEnd(20)} ${def.description}`);
        }
        console.log('\nUsage:');
        console.log('  pnpm -F db db:seed <scenario>     Run a scenario');
        console.log(
            '  pnpm -F db db:seed --clean         Remove all seed data'
        );
        console.log('  pnpm -F db db:seed --clean <name>  Clean then seed');
        process.exit(0);
    }

    console.log(`Running scenario: ${scenarioArg}...`);
    const start = Date.now();
    const result = await runScenario(db, scenarioArg);
    const elapsed = Date.now() - start;

    console.log(`Done in ${elapsed}ms:`);
    console.log(`  Users: ${result.users.length}`);
    console.log(`  Files: ${result.files.length}`);
    console.log(`  Subscriptions: ${result.subscriptions.length}`);
    console.log(`  Retrievals: ${result.retrievals.length}`);

    process.exit(0);
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
