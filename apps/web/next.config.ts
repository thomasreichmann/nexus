import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
    // @nexus/db exports raw TypeScript (JIT compilation, no build step)
    transpilePackages: ['@nexus/db'],
    // Pin the workspace root. Git worktrees carry their own pnpm-lock.yaml,
    // so Next's lockfile inference finds two candidates (worktree + primary
    // checkout), picks the wrong one, and warns on every build.
    turbopack: {
        root: path.join(__dirname, '../..'),
    },
};

export default nextConfig;
