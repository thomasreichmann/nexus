import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.HTMLAttributes<SVGSVGElement> {
    size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
} as const;

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
    ({ className, size = 'md', ...props }, ref) => {
        return (
            <Loader2
                ref={ref}
                className={cn('animate-spin', sizeClasses[size], className)}
                aria-label="Loading"
                {...props}
            />
        );
    }
);
Spinner.displayName = 'Spinner';

export { Spinner };
