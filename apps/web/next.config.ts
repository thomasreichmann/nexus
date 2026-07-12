import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
    // @nexus/db exports raw TypeScript (JIT compilation, no build step)
    transpilePackages: ['@nexus/db'],
};

export default withNextIntl(nextConfig);
