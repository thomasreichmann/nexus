'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { Database, Loader2 } from 'lucide-react';
import { ME_VALUE } from './presets';
import { TierBar, useSeedTools } from './use-seed-tools';

export function CustomSeedForm() {
    const { users, seed, isPending, isSuccess, lastData } = useSeedTools();
    const [targetUser, setTargetUser] = useState(ME_VALUE);
    const [fileCount, setFileCount] = useState(50);
    const [standard, setStandard] = useState(10);
    const [glacier, setGlacier] = useState(60);
    const [deepArchive, setDeepArchive] = useState(30);
    const [retrievalCount, setRetrievalCount] = useState(0);

    const tierTotal = standard + glacier + deepArchive || 1;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        seed(targetUser, {
            fileCount,
            storageTierDistribution: {
                standard: standard / tierTotal,
                glacier: glacier / tierTotal,
                deep_archive: deepArchive / tierTotal,
            },
            retrievalCount,
        });
    }

    return (
        <Card className="border-border/50 bg-zinc-900/60">
            <div className="border-b border-border/30 px-3 py-2">
                <span className="font-mono text-xs text-cyan-400/80">
                    {'>'} custom seed
                </span>
            </div>
            <CardContent className="space-y-3 p-3">
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-1.5">
                        <Label
                            htmlFor="custom-seed-target"
                            className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                        >
                            Target
                        </Label>
                        <select
                            id="custom-seed-target"
                            value={targetUser}
                            onChange={(e) => setTargetUser(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-zinc-950/50 px-2 font-mono text-sm"
                        >
                            <option value={ME_VALUE}>me (current user)</option>
                            {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.name} ({u.email})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="custom-seed-files"
                                className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                            >
                                Files
                            </Label>
                            <Input
                                id="custom-seed-files"
                                type="number"
                                min={1}
                                max={1000}
                                value={fileCount}
                                onChange={(e) =>
                                    setFileCount(Number(e.target.value))
                                }
                                className="h-8 bg-zinc-950/50 font-mono text-sm tabular-nums"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="custom-seed-retrievals"
                                className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                            >
                                Retrievals
                            </Label>
                            <Input
                                id="custom-seed-retrievals"
                                type="number"
                                min={0}
                                max={50}
                                value={retrievalCount}
                                onChange={(e) =>
                                    setRetrievalCount(Number(e.target.value))
                                }
                                className="h-8 bg-zinc-950/50 font-mono text-sm tabular-nums"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Tier distribution
                        </span>
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                {
                                    id: 'tier-standard',
                                    label: 'Standard',
                                    value: standard,
                                    set: setStandard,
                                    color: 'text-emerald-400',
                                },
                                {
                                    id: 'tier-glacier',
                                    label: 'Glacier',
                                    value: glacier,
                                    set: setGlacier,
                                    color: 'text-cyan-400',
                                },
                                {
                                    id: 'tier-deep-archive',
                                    label: 'Deep Archive',
                                    value: deepArchive,
                                    set: setDeepArchive,
                                    color: 'text-violet-400',
                                },
                            ].map((tier) => (
                                <div key={tier.label} className="space-y-0.5">
                                    <label
                                        htmlFor={tier.id}
                                        className={cn(
                                            'font-mono text-xs tracking-wider',
                                            tier.color
                                        )}
                                    >
                                        {tier.label}
                                    </label>
                                    <Input
                                        id={tier.id}
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={tier.value}
                                        onChange={(e) =>
                                            tier.set(Number(e.target.value))
                                        }
                                        className="h-7 bg-zinc-950/50 font-mono text-xs tabular-nums"
                                    />
                                </div>
                            ))}
                        </div>
                        <TierBar
                            distribution={{
                                standard: standard / tierTotal,
                                glacier: glacier / tierTotal,
                                deep_archive: deepArchive / tierTotal,
                            }}
                            className="h-1.5"
                        />
                    </div>

                    <Button
                        type="submit"
                        size="sm"
                        disabled={isPending}
                        className="h-8 w-full font-mono text-xs"
                    >
                        {isPending ? (
                            <Loader2
                                aria-hidden="true"
                                className="mr-1.5 h-3.5 w-3.5 animate-spin"
                            />
                        ) : (
                            <Database
                                aria-hidden="true"
                                className="mr-1.5 h-3.5 w-3.5"
                            />
                        )}
                        {isPending ? 'Seeding...' : 'Seed'}
                    </Button>

                    {isSuccess && lastData && (
                        <p
                            role="status"
                            className="font-mono text-xs text-emerald-400"
                        >
                            Seeded +{lastData.files} files
                            {lastData.retrievals > 0 &&
                                `, +${lastData.retrievals} retrievals`}
                        </p>
                    )}
                </form>
            </CardContent>
        </Card>
    );
}
