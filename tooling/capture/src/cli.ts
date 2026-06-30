import type { RunOverrides } from './runner';
import { runScene } from './runner';
import { findScene, scenes } from './scenes/index';

function parseNumber(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function printUsage(): void {
    console.log('Scenes:');
    for (const scene of scenes) {
        console.log(`  ${scene.name.padEnd(20)} ${scene.description}`);
    }
    console.log(
        '\nUsage: pnpm capture <scene...> [--mp4] [--no-gif] [--width=N] [--fps=N] [--speed=N] [--quality=N] [--keep-video] [--no-server]'
    );
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (
        argv.length === 0 ||
        argv.includes('--list') ||
        argv.includes('--help')
    ) {
        printUsage();
        return;
    }

    const flags = argv.filter((arg) => arg.startsWith('--'));
    const names = argv.filter((arg) => !arg.startsWith('--'));
    const valueOf = (key: string): string | undefined => {
        const hit = flags.find((flag) => flag.startsWith(`${key}=`));
        return hit?.slice(key.length + 1);
    };

    const overrides: RunOverrides = {
        mp4: flags.includes('--mp4') ? true : undefined,
        gif: flags.includes('--no-gif') ? false : undefined,
        width: parseNumber(valueOf('--width')),
        fps: parseNumber(valueOf('--fps')),
        speed: parseNumber(valueOf('--speed')),
        quality: parseNumber(valueOf('--quality')),
    };
    const runOptions = {
        manageServer: !flags.includes('--no-server'),
        keepVideo: flags.includes('--keep-video'),
        overrides,
    };

    const targets = names.map((name) => {
        const scene = findScene(name);
        if (!scene) {
            console.error(
                `Unknown scene "${name}". Run with --list to see scenes.`
            );
            process.exit(1);
        }
        return scene;
    });

    for (const scene of targets) {
        const written = await runScene(scene, runOptions);
        for (const file of written) console.log(`✓ wrote ${file}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
