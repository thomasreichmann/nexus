// This file is a stub that gets replaced at build time by embed-assets-plugin.
// The plugin injects the standalone bundle JS/CSS as embedded strings.
//
// If you see this error at runtime, the build order is wrong:
// Run `pnpm build:standalone` before `pnpm build:lib`

export function getStandaloneJs(): string {
    throw new Error(
        'Standalone assets not embedded. Build order: build:standalone must run before build:lib'
    );
}

export function getStandaloneCss(): string {
    throw new Error(
        'Standalone assets not embedded. Build order: build:standalone must run before build:lib'
    );
}
