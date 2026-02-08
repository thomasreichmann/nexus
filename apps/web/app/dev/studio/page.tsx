'use client';

import { TRPCStudio } from 'trpc-devtools';

export default function StudioPage() {
    return (
        <TRPCStudio schemaUrl="/api/trpc-studio/schema" trpcUrl="/api/trpc" />
    );
}
