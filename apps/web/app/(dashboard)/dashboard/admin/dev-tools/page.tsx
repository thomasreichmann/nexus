'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { FileStack, HardDrive, RotateCw, Users } from 'lucide-react';
import { CleanupControls } from './cleanup-controls';
import { CustomSeedForm } from './custom-seed-form';
import { ScenarioList } from './scenario-list';

export default function AdminDevToolsPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex items-baseline gap-3">
                <h1 className="font-mono text-xl font-bold tracking-tight">
                    dev-tools
                </h1>
                <span className="font-mono text-sm text-muted-foreground">
                    seed &amp; manage test data
                </span>
            </div>

            <SeedSummary />

            <div className="grid grid-cols-[1fr_340px] gap-4">
                <ScenarioList />
                <div className="space-y-4">
                    <CustomSeedForm />
                    <CleanupControls />
                </div>
            </div>
        </div>
    );
}

function SeedSummary() {
    const trpc = useTRPC();
    const { data, isLoading } = useQuery(
        trpc.admin.devTools.summary.queryOptions()
    );

    const stats = [
        {
            label: 'Seed Files',
            value: data?.files ?? 0,
            icon: FileStack,
            color: 'text-cyan-400',
        },
        {
            label: 'Retrievals',
            value: data?.retrievals ?? 0,
            icon: RotateCw,
            color: 'text-violet-400',
        },
        {
            label: 'Seed Users',
            value: data?.users ?? 0,
            icon: Users,
            color: 'text-emerald-400',
        },
    ];

    return (
        <div className="flex items-center gap-3">
            {stats.map((stat) => (
                <Card
                    key={stat.label}
                    className="flex-1 border-border/50 bg-zinc-900/60"
                >
                    <CardContent className="flex items-center gap-2.5 px-3 py-2.5">
                        <stat.icon
                            aria-hidden="true"
                            className={cn('h-4 w-4 shrink-0', stat.color)}
                        />
                        <span className="font-mono text-xs tracking-wide text-muted-foreground">
                            {stat.label}
                        </span>
                        <span className="ml-auto font-mono text-base font-semibold tabular-nums">
                            {isLoading ? (
                                <span className="text-muted-foreground/50">
                                    --
                                </span>
                            ) : (
                                stat.value
                            )}
                        </span>
                    </CardContent>
                </Card>
            ))}
            <Card className="border-border/50 bg-zinc-900/60">
                <CardContent className="flex items-center gap-2.5 px-3 py-2.5">
                    <HardDrive
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <span className="font-mono text-xs tracking-wide text-muted-foreground">
                        Storage
                    </span>
                    <span className="ml-auto font-mono text-base font-semibold tabular-nums">
                        {isLoading ? (
                            <span className="text-muted-foreground/50">--</span>
                        ) : (
                            formatBytes(data?.totalBytes ?? 0)
                        )}
                    </span>
                </CardContent>
            </Card>
        </div>
    );
}
