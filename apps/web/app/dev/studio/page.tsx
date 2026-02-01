'use client';

import { TRPCStudio } from '@nexus/trpc-studio';
import '@nexus/trpc-studio/styles.css';

export default function StudioPage() {
    return (
        <TRPCStudio schemaUrl="/api/trpc-studio/schema" trpcUrl="/api/trpc" />
    );
}
