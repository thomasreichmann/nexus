'use client';

import { TRPCDevtools } from 'trpc-devtools';

export default function StudioPage() {
    return (
        <TRPCDevtools
            schemaUrl="/api/trpc-devtools/schema"
            trpcUrl="/api/trpc"
        />
    );
}
