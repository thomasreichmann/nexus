'use client';

import { TRPCStudio } from 'trpc-devtools';
import 'trpc-devtools/styles.css';

export default function StudioPage() {
    return (
        <TRPCStudio schemaUrl="/api/trpc-studio/schema" trpcUrl="/api/trpc" />
    );
}
