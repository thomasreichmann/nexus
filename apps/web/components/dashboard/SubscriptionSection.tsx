'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CreditCard, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    PLAN_DISPLAY,
    comparePlans,
    decidePlanAction,
    getStatusBadge,
    type BillingInterval,
    type PlanDisplay,
} from './subscriptionPlans';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import type { CheckoutTier } from '@/lib/stripe/types';

export function SubscriptionSection() {
    const trpc = useTRPC();
    const [billingInterval, setBillingInterval] =
        useState<BillingInterval>('month');

    const { data: subscription, isLoading } = useQuery(
        trpc.subscriptions.current.queryOptions()
    );

    const checkout = useMutation(
        trpc.subscriptions.createCheckoutSession.mutationOptions({
            onSuccess: (data) => {
                window.location.assign(data.url);
            },
        })
    );

    const portal = useMutation(
        trpc.subscriptions.createPortalSession.mutationOptions({
            onSuccess: (data) => {
                window.location.assign(data.url);
            },
        })
    );

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                    <CardTitle>Subscription</CardTitle>
                    <CardDescription>Manage your storage plan</CardDescription>
                </div>
                <CreditCard className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-6">
                {isLoading ? (
                    <SubscriptionSkeleton />
                ) : !subscription ? (
                    <p className="text-sm text-muted-foreground">
                        Your subscription isn&apos;t provisioned yet. Contact
                        support if this persists.
                    </p>
                ) : (
                    <SubscriptionView
                        subscription={subscription}
                        interval={billingInterval}
                        onIntervalChange={setBillingInterval}
                        onCheckout={(tier) =>
                            checkout.mutate({
                                tier,
                                interval: billingInterval,
                            })
                        }
                        onPortal={() => portal.mutate()}
                        pendingCheckoutTier={
                            checkout.isPending
                                ? checkout.variables?.tier
                                : undefined
                        }
                        isOpeningPortal={portal.isPending}
                    />
                )}
            </CardContent>
        </Card>
    );
}

interface SubscriptionViewProps {
    subscription: Subscription;
    interval: BillingInterval;
    onIntervalChange: (next: BillingInterval) => void;
    onCheckout: (tier: CheckoutTier) => void;
    onPortal: () => void;
    pendingCheckoutTier: CheckoutTier | undefined;
    isOpeningPortal: boolean;
}

function SubscriptionView({
    subscription,
    interval,
    onIntervalChange,
    onCheckout,
    onPortal,
    pendingCheckoutTier,
    isOpeningPortal,
}: SubscriptionViewProps) {
    const statusBadge = getStatusBadge(subscription.status);
    const canManageBilling = subscription.stripeSubscriptionId !== null;

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Badge variant={statusBadge.variant}>
                        {statusBadge.label}
                    </Badge>
                    <SubscriptionMeta subscription={subscription} />
                </div>
                <BillingIntervalToggle
                    value={interval}
                    onChange={onIntervalChange}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {PLAN_DISPLAY.map((plan) => (
                    <PlanCard
                        key={plan.tier}
                        plan={plan}
                        interval={interval}
                        currentTier={subscription.planTier}
                        hasActiveSub={canManageBilling}
                        pendingCheckoutTier={pendingCheckoutTier}
                        isOpeningPortal={isOpeningPortal}
                        onCheckout={onCheckout}
                        onPortal={onPortal}
                    />
                ))}
            </div>

            <div className="flex items-center justify-between border-t pt-4">
                <p className="text-sm text-muted-foreground">
                    Update payment method, view invoices, or cancel in the
                    Stripe portal.
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onPortal}
                    disabled={!canManageBilling || isOpeningPortal}
                >
                    {isOpeningPortal && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Manage billing
                </Button>
            </div>
        </>
    );
}

function SubscriptionMeta({ subscription }: { subscription: Subscription }) {
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
        return (
            <span className="text-sm text-muted-foreground">
                Subscription ends on {formatDate(subscription.currentPeriodEnd)}
            </span>
        );
    }
    if (subscription.status === 'trialing' && subscription.trialEnd) {
        return (
            <span className="text-sm text-muted-foreground">
                Trial ends on {formatDate(subscription.trialEnd)}
            </span>
        );
    }
    if (subscription.currentPeriodEnd) {
        return (
            <span className="text-sm text-muted-foreground">
                Next billing on {formatDate(subscription.currentPeriodEnd)}
            </span>
        );
    }
    return null;
}

function BillingIntervalToggle({
    value,
    onChange,
}: {
    value: BillingInterval;
    onChange: (next: BillingInterval) => void;
}) {
    return (
        <div
            role="group"
            aria-label="Billing interval"
            className="inline-flex rounded-md border p-0.5"
        >
            {(['month', 'year'] as const).map((option) => (
                <button
                    key={option}
                    type="button"
                    aria-pressed={value === option}
                    onClick={() => onChange(option)}
                    className={cn(
                        'rounded-sm px-3 py-1 text-sm transition-colors',
                        value === option
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {option === 'month' ? 'Monthly' : 'Annual'}
                </button>
            ))}
        </div>
    );
}

interface PlanCardProps {
    plan: PlanDisplay;
    interval: BillingInterval;
    currentTier: Subscription['planTier'];
    hasActiveSub: boolean;
    pendingCheckoutTier: CheckoutTier | undefined;
    isOpeningPortal: boolean;
    onCheckout: (tier: CheckoutTier) => void;
    onPortal: () => void;
}

function PlanCard({
    plan,
    interval,
    currentTier,
    hasActiveSub,
    pendingCheckoutTier,
    isOpeningPortal,
    onCheckout,
    onPortal,
}: PlanCardProps) {
    const comparison = comparePlans(currentTier, plan.tier);
    const price = plan.prices[interval];

    return (
        <div
            className={cn(
                'relative rounded-lg border p-4',
                comparison === 'current'
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
            )}
        >
            {comparison === 'current' && (
                <Badge className="absolute -top-2 right-2">Current</Badge>
            )}
            <h3 className="font-semibold">{plan.name}</h3>
            <p className="text-sm text-muted-foreground">{plan.storage}</p>
            <p className="mt-2 text-2xl font-bold">
                ${price}
                <span className="text-sm font-normal text-muted-foreground">
                    {interval === 'month' ? '/mo' : '/yr'}
                </span>
            </p>
            <PlanAction
                comparison={comparison}
                hasActiveSub={hasActiveSub}
                isPendingThisCheckout={pendingCheckoutTier === plan.tier}
                isAnyCheckoutPending={pendingCheckoutTier !== undefined}
                isOpeningPortal={isOpeningPortal}
                onCheckout={() => onCheckout(plan.tier)}
                onPortal={onPortal}
            />
        </div>
    );
}

function PlanAction({
    comparison,
    hasActiveSub,
    isPendingThisCheckout,
    isAnyCheckoutPending,
    isOpeningPortal,
    onCheckout,
    onPortal,
}: {
    comparison: 'current' | 'upgrade' | 'downgrade';
    hasActiveSub: boolean;
    isPendingThisCheckout: boolean;
    isAnyCheckoutPending: boolean;
    isOpeningPortal: boolean;
    onCheckout: () => void;
    onPortal: () => void;
}) {
    const decision = decidePlanAction({
        comparison,
        hasActiveSub,
        isPendingThisCheckout,
        isAnyCheckoutPending,
        isOpeningPortal,
    });

    if (decision.kind === 'current') {
        return (
            <div className="mt-3 flex items-center gap-1 text-sm text-primary">
                <Check className="h-4 w-4" />
                Active
            </div>
        );
    }

    return (
        <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={decision.target === 'checkout' ? onCheckout : onPortal}
            disabled={decision.disabled}
        >
            {decision.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {decision.label}
        </Button>
    );
}

function SubscriptionSkeleton() {
    return (
        <>
            <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-8 w-40" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 w-full rounded-lg" />
                ))}
            </div>
            <div className="flex items-center justify-between border-t pt-4">
                <Skeleton className="h-4 w-72" />
                <Skeleton className="h-8 w-32" />
            </div>
        </>
    );
}
