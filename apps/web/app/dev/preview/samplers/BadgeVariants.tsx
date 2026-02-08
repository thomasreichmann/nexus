import { Badge } from '@/components/ui/badge';

export function BadgeVariants() {
    return (
        <div className="flex flex-wrap gap-2">
            <Badge variant="destructive">Destructive</Badge>
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
        </div>
    );
}
