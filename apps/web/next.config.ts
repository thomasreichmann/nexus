import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
    // @nexus/db exports raw TypeScript (JIT compilation, no build step)
    transpilePackages: ['@nexus/db'],
};

export default nextConfig;
