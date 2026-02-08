import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?:
        | 'default'
        | 'secondary'
        | 'destructive'
        | 'outline'
        | 'query'
        | 'mutation'
        | 'subscription';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
    return (
        <div
            className={cn(
                'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                // Variants
                variant === 'default' &&
                    'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
                variant === 'secondary' &&
                    'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
                variant === 'destructive' &&
                    'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
                variant === 'outline' && 'text-foreground',
                // Procedure type variants
                variant === 'query' &&
                    'border-transparent bg-blue-600 text-white',
                variant === 'mutation' &&
                    'border-transparent bg-green-600 text-white',
                variant === 'subscription' &&
                    'border-transparent bg-purple-600 text-white',
                className
            )}
            {...props}
        />
    );
}

export { Badge };
