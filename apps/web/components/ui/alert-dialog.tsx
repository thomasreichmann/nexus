import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
    return (
        <AlertDialogPrimitive.Trigger
            data-slot="alert-dialog-trigger"
            {...props}
        />
    );
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
    return (
        <AlertDialogPrimitive.Portal
            data-slot="alert-dialog-portal"
            {...props}
        />
    );
}

function AlertDialogBackdrop({
    className,
    ...props
}: AlertDialogPrimitive.Backdrop.Props) {
    return (
        <AlertDialogPrimitive.Backdrop
            data-slot="alert-dialog-backdrop"
            className={cn(
                'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-50 bg-black/50',
                className
            )}
            {...props}
        />
    );
}

function AlertDialogPopup({
    className,
    children,
    ...props
}: AlertDialogPrimitive.Popup.Props) {
    return (
        <AlertDialogPortal>
            <AlertDialogBackdrop />
            <AlertDialogPrimitive.Popup
                data-slot="alert-dialog-popup"
                className={cn(
                    'bg-background data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
                    className
                )}
                {...props}
            >
                {children}
            </AlertDialogPrimitive.Popup>
        </AlertDialogPortal>
    );
}

function AlertDialogTitle({
    className,
    ...props
}: AlertDialogPrimitive.Title.Props) {
    return (
        <AlertDialogPrimitive.Title
            data-slot="alert-dialog-title"
            className={cn('text-lg font-semibold', className)}
            {...props}
        />
    );
}

function AlertDialogDescription({
    className,
    ...props
}: AlertDialogPrimitive.Description.Props) {
    return (
        <AlertDialogPrimitive.Description
            data-slot="alert-dialog-description"
            className={cn('text-muted-foreground text-sm', className)}
            {...props}
        />
    );
}

function AlertDialogAction({
    className,
    variant = 'destructive',
    size,
    ...props
}: AlertDialogPrimitive.Close.Props & VariantProps<typeof buttonVariants>) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-action"
            className={cn(buttonVariants({ variant, size }), className)}
            {...props}
        />
    );
}

function AlertDialogCancel({
    className,
    ...props
}: AlertDialogPrimitive.Close.Props) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-cancel"
            className={cn(buttonVariants({ variant: 'outline' }), className)}
            {...props}
        />
    );
}

export {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogPortal,
    AlertDialogBackdrop,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
};
