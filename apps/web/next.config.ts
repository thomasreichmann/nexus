import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
};

export default nextConfig;
