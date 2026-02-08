import { Button } from '@/components/ui/button';

export function ButtonVariants() {
    return (
        <div className="flex flex-wrap gap-2">
            <Button variant="destructive" size="sm">
                Destructive
            </Button>
            <Button size="sm">Primary</Button>
            <Button variant="secondary" size="sm">
                Secondary
            </Button>
            <Button variant="outline" size="sm">
                Outline
            </Button>
            <Button variant="ghost" size="sm">
                Ghost
            </Button>
        </div>
    );
}
