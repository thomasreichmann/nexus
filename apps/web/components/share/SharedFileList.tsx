'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileIcon, Loader2 } from 'lucide-react';
import { MiddleTruncateName } from '@/components/dashboard/MiddleTruncateName';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';

interface SharedFile {
    id: string;
    name: string;
    size: number;
}

interface SharedFileListProps {
    shareId: string;
    files: SharedFile[];
}

export function SharedFileList({ shareId, files }: SharedFileListProps) {
    const trpc = useTRPC();
    const getDownloadUrl = useMutation(
        trpc.shares.getDownloadUrl.mutationOptions()
    );
    const [preparingId, setPreparingId] = useState<string | null>(null);

    async function download(file: SharedFile) {
        setPreparingId(file.id);
        try {
            // Minted on the click: each URL is short-lived and counts toward
            // the file's download limit, and a link that expired since the
            // page loaded has to say so.
            const { url } = await getDownloadUrl.mutateAsync({
                shareId,
                fileId: file.id,
            });
            // The response is an attachment, so this starts a download and
            // leaves the page where it is.
            window.location.assign(url);
        } catch {
            // The tRPC error link has already shown the reason.
        } finally {
            setPreparingId(null);
        }
    }

    return (
        <Card>
            <CardContent>
                <ul className="divide-y divide-border">
                    {files.map((file) => (
                        <li
                            key={file.id}
                            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                        >
                            <FileIcon className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <MiddleTruncateName
                                    name={file.name}
                                    className="text-sm font-medium"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {formatBytes(file.size)}
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={preparingId === file.id}
                                aria-label={`Download ${file.name}`}
                                onClick={() => download(file)}
                            >
                                {preparingId === file.id ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Download />
                                )}
                                Download
                            </Button>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
