import { UploadZone } from '@/components/dashboard/upload-zone';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Clock, Shield, Info } from 'lucide-react';

export default function UploadPage() {
    return (
        <div className="mx-auto max-w-4xl space-y-8">
            <div>
                <h1 className="text-2xl font-bold">Upload Files</h1>
                <p className="text-muted-foreground">
                    Add files to your deep storage archive
                </p>
            </div>

            <UploadZone />

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-primary" />
                            <CardTitle className="text-sm font-medium">
                                Archival Storage
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <CardDescription>
                            Files are archived to deep storage. Retrieval takes
                            3-12 hours when you need them.
                        </CardDescription>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            <CardTitle className="text-sm font-medium">
                                Encrypted & Secure
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <CardDescription>
                            All files are encrypted at rest and in transit. Your
                            data is always protected.
                        </CardDescription>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Info className="h-4 w-4 text-primary" />
                            <CardTitle className="text-sm font-medium">
                                Any File Type
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <CardDescription>
                            Upload any file type, any size. Perfect for photos,
                            videos, backups, and archives.
                        </CardDescription>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
