'use client';

import { useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSeedTools } from './useSeedTools';

interface CustomSeedFormProps {
    targetUser: string;
}

export function CustomSeedForm({ targetUser }: CustomSeedFormProps) {
    const { seed, isPending, isSuccess, lastData } = useSeedTools();
    const [fileCount, setFileCount] = useState(50);
    const [retrievalCount, setRetrievalCount] = useState(0);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        seed(targetUser, { fileCount, retrievalCount });
    }

    return (
        <Card className="border-border/50 bg-zinc-900/60">
            <div className="border-b border-border/30 px-3 py-2">
                <h2 className="font-mono text-xs text-cyan-400/80">
                    {'>'} custom seed
                </h2>
            </div>
            <CardContent className="space-y-3 p-3">
                <form onSubmit={handleSubmit} className="space-y-3">
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

                    <Button
                        type="submit"
                        size="sm"
                        disabled={isPending}
                        className="h-8 w-full font-mono text-xs"
                    >
                        {isPending ? (
                            <Loader2
                                aria-hidden="true"
                                className="mr-1.5 size-3.5 animate-spin"
                            />
                        ) : (
                            <Database
                                aria-hidden="true"
                                className="mr-1.5 size-3.5"
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
