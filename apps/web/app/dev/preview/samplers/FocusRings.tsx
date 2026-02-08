import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Sampler that displays interactive elements with focus rings always visible.
 * Uses the same ring utilities as production components (border-ring, ring-ring/50,
 * ring-[3px]) but applied unconditionally so the --ring color is visible without
 * requiring keyboard focus.
 */
export function FocusRings() {
    const ringClasses = 'border-ring ring-ring/50 ring-[3px]';

    return (
        <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
                Focus rings
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" className={ringClasses}>
                    Button
                </Button>
                <Button variant="outline" size="sm" className={ringClasses}>
                    Outline
                </Button>
                <Button variant="secondary" size="sm" className={ringClasses}>
                    Secondary
                </Button>
            </div>
            <div className="max-w-xs">
                <Input placeholder="Input field" className={ringClasses} />
            </div>
            <div className="flex items-center gap-2">
                <Checkbox id="focus-demo" className={ringClasses} />
                <label htmlFor="focus-demo" className="text-sm text-foreground">
                    Checkbox
                </label>
            </div>
        </div>
    );
}
