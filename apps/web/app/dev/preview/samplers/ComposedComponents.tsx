import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function ComposedComponents() {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">Sample Card</CardTitle>
                <CardDescription>Nested component preview</CardDescription>
            </CardHeader>
            <CardContent>
                <Input placeholder="Input field" />
            </CardContent>
        </Card>
    );
}
