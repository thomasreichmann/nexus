import * as React from 'react';
import { cn } from '@/lib/utils';

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
    orientation?: 'vertical' | 'horizontal';
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
    ({ className, children, orientation = 'vertical', ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn('relative overflow-hidden', className)}
                {...props}
            >
                <div
                    className={cn(
                        'h-full w-full overflow-auto',
                        orientation === 'vertical' && 'pr-3',
                        orientation === 'horizontal' && 'pb-3'
                    )}
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'hsl(var(--muted)) transparent',
                    }}
                >
                    {children}
                </div>
            </div>
        );
    }
);
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
