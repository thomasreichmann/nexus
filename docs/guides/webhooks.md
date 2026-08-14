---
title: Webhook Handling
created: 2026-02-15
updated: 2026-08-13
status: active
tags:
    - guide
    - webhooks
    - stripe
    - aws
    - backend
aliases:
    - Webhook Guide
    - Webhook Pattern
ai_summary: 'Webhook handler architecture: signature verification, idempotency, error handling, testing'
---

# Webhook Handling

Patterns and conventions for handling inbound webhooks from external providers (Stripe, AWS SNS).

## Architecture Overview

```
External Provider                Nexus (Next.js / Vercel)
┌─────────────────┐    ┌────────────────────────────────────────────┐
│ Stripe / SNS     │    │  POST /api/webhooks/stripe                 │
│   event fires    │───▶│    ↓                                       │
│                  │    │  Verify signature (raw body)               │
│  retries on 5xx  │    │    ↓                                       │
│  or timeout      │    │  Check idempotency (webhook_events table)  │
│                  │    │    ↓                                       │
└─────────────────┘    │  Dispatch to event handler                  │
                       │    ↓                                       │
                       │  Service layer (business logic)             │
                       │    ↓ (optional)                             │
                       │  jobs.publish() for async work              │
                       └────────────────────────────────────────────┘
                                        │
                                  Supabase (PostgreSQL)
```

**Key principles:**

- Webhooks are **raw HTTP endpoints** — they bypass tRPC (providers POST to a fixed URL)
- The route handler is **thin** — verify, deduplicate, dispatch, respond
- Business logic lives in the **service layer**, same as tRPC procedures
- Heavy processing is deferred to **background jobs** via `jobs.publish()`

## File Structure

```
apps/web/
├── app/api/webhooks/
│   ├── stripe/route.ts          # Stripe webhook endpoint
│   └── s3-restore/route.ts      # AWS SNS S3 restore endpoint (future)
├── lib/stripe/
│   ├── client.ts                # Stripe SDK singleton
│   ├── webhooks.ts              # Signature verification + event construction
│   ├── testing.ts               # Mock helpers (createMockStripeEvent, etc.)
│   └── index.ts                 # Namespace export: export const stripe = { ... }
└── server/services/
    └── stripe.ts                # Business logic: export const stripeService = { ... }

packages/db/src/
├── schema/webhooks.ts           # webhook_events table
├── repositories/webhooks.ts     # Data access for webhook events
└── webhooks/types.ts            # Shared types (WebhookSource, etc.)
```

**Follows existing patterns:**

- `lib/stripe/` mirrors `lib/storage/` (client singleton + namespace export)
- `server/services/stripe.ts` follows the service namespace pattern from [[server-architecture|Server Architecture]]
- Route handlers follow the same `NextRequest`/`NextResponse` pattern as `app/api/dev-log/route.ts`

## Signature Verification

Every webhook endpoint **must** verify the request signature before processing. This prevents spoofed events.

### Stripe

Stripe signs webhooks with `stripe-signature` header. Verification requires the **raw request body** (not parsed JSON).

```typescript
// lib/stripe/webhooks.ts
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { stripeClient } from './client';

/**
 * Verify and construct a Stripe webhook event from a request.
 * Returns the parsed event, or throws on invalid signature.
 */
export function constructEvent(
    rawBody: string,
    signature: string
): Stripe.Event {
    return stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET
    );
}
```

```typescript
// app/api/webhooks/stripe/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { constructEvent } from '@/lib/stripe/webhooks';

export async function POST(request: NextRequest): Promise<NextResponse> {
    // 1. Read raw body BEFORE parsing
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return NextResponse.json(
            { error: 'Missing stripe-signature header' },
            { status: 400 }
        );
    }

    // 2. Verify signature
    let event;
    try {
        event = constructEvent(rawBody, signature);
    } catch {
        return NextResponse.json(
            { error: 'Invalid signature' },
            { status: 400 }
        );
    }

    // 3. Process event (see Idempotency and Dispatch sections)
    // ...

    return NextResponse.json({ received: true });
}
```

**Critical:** Call `request.text()` to get the raw body. If you parse the body as JSON first (`request.json()`), Stripe signature verification will fail because `JSON.stringify(JSON.parse(body))` may not match the original payload.

### AWS SNS

SNS uses certificate-based message signing. AWS provides an SDK for verification.

```typescript
// lib/sns/webhooks.ts
import { MessageValidator } from 'sns-validator';

const validator = new MessageValidator();

/**
 * Verify an SNS message signature.
 * Rejects if the certificate URL doesn't match *.amazonaws.com.
 */
export async function verifySnsMessage(
    body: Record<string, unknown>
): Promise<void> {
    return new Promise((resolve, reject) => {
        validator.validate(body, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
```

**SNS has two message types:**

| Type                       | Action                                                 |
| -------------------------- | ------------------------------------------------------ |
| `SubscriptionConfirmation` | Auto-confirm by fetching the `SubscribeURL` (one-time) |
| `Notification`             | Process the event payload                              |
| `UnsubscribeConfirmation`  | Log and ignore (shouldn't happen in normal operation)  |

## Idempotency

External providers retry webhook deliveries. Stripe may send the same event multiple times. SNS guarantees **at-least-once** delivery. Without deduplication, events get processed more than once.

### Strategy: `webhook_events` Table

Track every processed event in a `webhook_events` table with a unique constraint on the provider event ID. Before processing, check if the event was already handled.

The check is on **status**, not existence. A row is inserted at `received` and only moves to a terminal status after dispatch, so a crash in between leaves a `received` row behind. Short-circuiting on any existing row makes that strand permanent — the provider's redelivery is the only thing that would recover it, and it gets turned away. Only `processed` means "already done".

Both routes get this from `resolveWebhookEvent` in `apps/web/lib/webhooks/events.ts` rather than restating it — it owns the find-or-insert, the `processed` short-circuit, and the concurrent-insert race.

```typescript
const lookup = await resolveWebhookEvent(webhookRepo, {
    source: 'stripe',
    externalId: event.id,
    eventType: event.type,
    payload: event,
});

// 'duplicate' — genuinely done, or a concurrent insert won the race
if (lookup.outcome === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true });
}

// 'new' or 'retry' — a 'received'/'failed'/'unhandled' row is re-driven
const webhookEvent = lookup.event;

// Process the event...
// On success: mark as 'processed' (or 'unhandled' if no handler matched)
// On business failure: recordWebhookFailure() marks it and alerts
// On transient failure: rethrow, leaving the row at its current status
```

Rows that never reach a terminal status are swept nightly — see [When to Return 5xx](#when-to-return-5xx).

### Table Schema

See `packages/db/src/schema/webhooks.ts` for the full schema. Key columns:

| Column       | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `externalId` | Provider's event ID (e.g., `evt_1234` from Stripe) |
| `source`     | Provider name (`stripe`, `sns`)                    |
| `eventType`  | Event type string (e.g., `invoice.paid`)           |
| `payload`    | Full event payload as JSONB (for debugging)        |
| `status`     | `received` → `processed` / `failed` / `unhandled`  |
| `error`      | Error message if processing failed                 |

**Unique constraint** on `(source, external_id)` prevents duplicate inserts. If a concurrent request tries to insert the same event, the DB rejects it.

### Payload Retention & Cleanup

Webhook payloads are stored for **debugging**. There is no replay tooling — the payload lets you reconstruct what happened, not re-run it. Recovery comes from provider redelivery hitting the status-aware idempotency check above.

- **Active retention:** 90 days
- **Cleanup:** Scheduled job (or manual query) deletes `webhook_events` rows older than 90 days where `status = 'processed'`
- **Failed events:** Retained indefinitely until manually reviewed and resolved

```sql
-- Example cleanup query (run as scheduled job or manual maintenance)
DELETE FROM webhook_events
WHERE status = 'processed'
  AND created_at < NOW() - INTERVAL '90 days';
```

## Event Dispatch

After verifying the signature and checking idempotency, dispatch the event to the appropriate handler. Use a registry pattern (similar to the [[lambda-development#job-registry|Lambda worker's job registry]]).

```typescript
// server/services/stripe.ts
import type Stripe from 'stripe';
import type { DB } from '@nexus/db';

type StripeEventHandler = (db: DB, event: Stripe.Event) => Promise<void>;

const handlers: Partial<Record<Stripe.Event.Type, StripeEventHandler>> = {
    'checkout.session.completed': handleCheckoutCompleted,
    'invoice.paid': handleInvoicePaid,
    'customer.subscription.deleted': handleSubscriptionDeleted,
};

async function handleCheckoutCompleted(
    db: DB,
    event: Stripe.Event
): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    // Business logic here — update subscription status, provision resources, etc.
}

// ... other handlers

/**
 * Dispatch a Stripe event to the appropriate handler.
 * Returns false if no handler is registered for the event type.
 */
async function dispatch(db: DB, event: Stripe.Event): Promise<boolean> {
    const handler = handlers[event.type];
    if (!handler) {
        return false;
    }
    await handler(db, event);
    return true;
}

export const stripeService = {
    dispatch,
} as const;
```

## Error Handling

Webhook error handling must consider provider retry behavior. The HTTP status code you return tells the provider whether to retry.

### Response Strategy

| Scenario                            | Status | Provider Behavior  | Why                                                      |
| ----------------------------------- | ------ | ------------------ | -------------------------------------------------------- |
| Signature verification failed       | `400`  | No retry           | Bad request — retrying won't fix it                      |
| Duplicate event (already processed) | `200`  | No retry           | Already handled — stop sending                           |
| Event processed successfully        | `200`  | No retry           | Done                                                     |
| Unregistered event type             | `200`  | No retry           | We don't care about this event type — don't keep sending |
| Business logic error                | `200`  | No retry           | Our bug — retrying won't help, fix code instead          |
| Transient error (DB down, timeout)  | `500`  | Retry with backoff | Temporary issue — retry later                            |

**Key insight:** Return `200` for business logic errors. Returning `5xx` would trigger retries, which would fail the same way. Log the error, mark the `webhook_events` record as `failed`, and investigate.

The split is not a judgment call at the call site — `isTransientInfraError` in `@/lib/errors` decides it, and both routes rethrow when it says yes.

### Route Handler Error Handling

```typescript
// app/api/webhooks/stripe/route.ts (continued)
export async function POST(request: NextRequest): Promise<NextResponse> {
    // ... signature verification ...
    // ... idempotency check ...

    try {
        const wasHandled = await stripeService.dispatch(db, event);

        if (!wasHandled) {
            logger.debug(
                { eventType: event.type },
                'Unhandled webhook event type'
            );
        }

        await updateWebhookEvent(db, webhookEvent.id, { status: 'processed' });
        return NextResponse.json({ received: true });
    } catch (error) {
        logger.error(
            { err: error, eventId: event.id, eventType: event.type },
            'Webhook processing failed'
        );

        // Transient failures rethrow: Next.js turns that into a 500 and the
        // provider retries. Nothing is written first — if the database is
        // what broke, the write fails too, and the row staying at 'received'
        // is what the nightly sweep looks for.
        if (isTransientInfraError(error)) throw error;

        await updateWebhookEvent(db, webhookEvent.id, {
            status: 'failed',
            error: toErrorMessage(error),
        });

        // Business errors return 200: a retry hits the same bug.
        return NextResponse.json({ received: true });
    }
}
```

### When to Return 5xx

Reserve `500` for infrastructure failures where a retry would genuinely help:

- Database connection refused
- Connection timeout to a dependent service
- Out of memory / process crash (automatic — Vercel returns 500)

Don't decide this by hand. `isTransientInfraError` (`apps/web/lib/errors.ts`) is an **allowlist** of Node socket codes, postgres.js connection states, and the Postgres SQLSTATE families that clear on their own (class `08`, plus `53300`, `57P01`, `40001`, `40P01`). It walks the `cause` chain, because undici reports a refused connection as `TypeError: fetch failed` with the real code one level down. Anything it doesn't recognise is a business error and returns `200`.

Allowlist, not denylist, on purpose: an unrecognised error retried forever is worse than one recorded as `failed` and investigated.

#### This supersedes #281 for the transient class

#281 decided "responses stay 200 in all cases", on the premise that "you can always replay events from the `webhook_events` table." That premise was never true. No replay tooling was built, and until #331 the nightly health check never queried `status = 'received'` at all — so a crash between the insert and the status update produced a row that was invisible to every check and that no redelivery could recover, because the S3-restore route's idempotency check turned away any existing row regardless of status.

What changed in #331:

- The S3-restore check became status-aware, so provider redelivery re-drives stranded rows (the Stripe route already did this, from #201).
- `check-s3-event-health` gained a leg for rows sitting at `received` for over an hour, across both sources. Unlike the failed leg it has no lower time bound: a `failed` row is history, a `received` row is an open incident, so it holds the check red until someone resolves it.
- Transient failures rethrow, so the provider's own retry is the first line of recovery rather than a nightly script.

The rest of #281 stands: unhandled events, business errors, and duplicates all still return `200`.

## Logging

Webhook handlers use the server logger directly since they bypass tRPC (and its request-scoped logging middleware).

```typescript
import { logger } from '@/server/lib/logger';

// Create a child logger with webhook context
const log = logger.child({ handler: 'stripe-webhook' });
```

### What to Log

| Event                         | Level   | Context Fields                            |
| ----------------------------- | ------- | ----------------------------------------- |
| Event received                | `info`  | `eventId`, `eventType`, `source`          |
| Duplicate event skipped       | `debug` | `eventId`, `eventType`, `duplicate: true` |
| Event processed               | `info`  | `eventId`, `eventType`, `durationMs`      |
| Unregistered event type       | `debug` | `eventType`                               |
| Processing failed             | `error` | `eventId`, `eventType`, `err`             |
| Signature verification failed | `warn`  | `source`, `ip` (from request headers)     |

### Example

```typescript
const start = Date.now();
log.info(
    { eventId: event.id, eventType: event.type },
    'Webhook event received'
);

// ... process event ...

log.info(
    {
        eventId: event.id,
        eventType: event.type,
        durationMs: Date.now() - start,
    },
    'Webhook event processed'
);
```

See [[logging|Logging Guide]] for the full logging architecture.

## Testing

### Local Development with Stripe CLI

Forward real Stripe webhook events to your local dev server:

```bash
# Install Stripe CLI (macOS)
brew install stripe/stripe-cli/stripe

# Login to your Stripe account
stripe login

# Forward events to your local webhook endpoint
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# In another terminal, trigger test events
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger customer.subscription.deleted
```

The `stripe listen` command prints a webhook signing secret (`whsec_...`). Set this as `STRIPE_WEBHOOK_SECRET` in `.env.local` for local development.

### Integration Tests

Webhook integration tests follow the same pattern as the background jobs integration tests — POST to the endpoint, assert on DB state and HTTP response codes. Uses `vitest.integration.config.ts`.

```typescript
// app/api/webhooks/stripe/route.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDb, webhookEvents, type DB } from '@nexus/db';

const db: DB = createDb(process.env.DATABASE_URL!);
const createdEvents: string[] = [];

afterAll(async () => {
    for (const id of createdEvents) {
        await db.delete(webhookEvents).where(eq(webhookEvents.id, id));
    }
});

describe('POST /api/webhooks/stripe', () => {
    it('rejects requests without stripe-signature header', async () => {
        const res = await fetch('http://localhost:3000/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'test' }),
        });

        expect(res.status).toBe(400);
    });

    it('processes a valid event and creates a webhook_events record', async () => {
        // Use Stripe SDK to construct a signed test event
        // or use the Stripe CLI to trigger and capture
        // ...

        // Assert DB record was created
        const record = await db.query.webhookEvents.findFirst({
            where: and(
                eq(webhookEvents.source, 'stripe'),
                eq(webhookEvents.externalId, 'evt_test_123')
            ),
        });

        expect(record).toBeDefined();
        expect(record!.status).toBe('processed');
    });

    it('returns 200 for duplicate events', async () => {
        // Send the same event ID twice
        // Second request should return { received: true, duplicate: true }
    });
});
```

### Manual SNS Testing

Fire SNS-shaped payloads to test the SNS endpoint locally:

```bash
# Subscription confirmation (one-time)
curl -X POST http://localhost:3000/api/webhooks/s3-restore \
  -H 'Content-Type: application/json' \
  -H 'x-amz-sns-message-type: SubscriptionConfirmation' \
  -d '{
    "Type": "SubscriptionConfirmation",
    "MessageId": "test-123",
    "TopicArn": "arn:aws:sns:us-east-1:123456789:nexus-events",
    "Message": "You have chosen to subscribe...",
    "SubscribeURL": "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&..."
  }'

# S3 event notification via SNS
curl -X POST http://localhost:3000/api/webhooks/s3-restore \
  -H 'Content-Type: application/json' \
  -H 'x-amz-sns-message-type: Notification' \
  -d '{
    "Type": "Notification",
    "MessageId": "msg-456",
    "TopicArn": "arn:aws:sns:us-east-1:123456789:nexus-events",
    "Subject": "Amazon S3 Notification",
    "Message": "{\"Records\":[{\"eventName\":\"ObjectRestore:Completed\",\"s3\":{\"bucket\":{\"name\":\"nexus-storage-files-dev\"},\"object\":{\"key\":\"user-123/file-456/document.pdf\"}}}]}"
  }'
```

> **Wire format:** the delivered `eventName` is **unprefixed**
> (`ObjectRestore:Completed`, `LifecycleTransition`) even though the bucket
> notification config subscribes with `s3:`-prefixed event types. Payloads
> replayed with the prefix will silently match no handler (#271).

> **Note:** These manual tests skip signature verification. In the SNS route handler, you can bypass verification in development by checking `NODE_ENV` — but never skip it in production.

### Unit Tests

Unit test the dispatch logic and individual event handlers by mocking the database:

```typescript
// server/services/stripe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { stripeService } from './stripe';

describe('stripeService.dispatch', () => {
    it('dispatches checkout.session.completed events', async () => {
        const mockDb = {} as DB;
        const event = createMockStripeEvent('checkout.session.completed', {
            id: 'cs_test_123',
            payment_status: 'paid',
        });

        await stripeService.dispatch(mockDb, event);
        // Assert on side effects (DB calls, job publishes, etc.)
    });

    it('returns false for unregistered event types', async () => {
        const mockDb = {} as DB;
        const event = createMockStripeEvent('coupon.created', {});

        const handled = await stripeService.dispatch(mockDb, event);
        expect(handled).toBe(false);
    });
});
```

## Security Checklist

Before deploying a webhook endpoint:

- [ ] Signature verification is **mandatory** — never skip in production
- [ ] Raw body is used for verification (not re-serialized JSON)
- [ ] Webhook secrets are stored in env vars, never hardcoded
- [ ] Idempotency is enforced via `webhook_events` table
- [ ] No sensitive data is logged (mask card numbers, tokens, etc.)
- [ ] Route does not expose internal error details in the response body
- [ ] SNS certificate URL is validated against `*.amazonaws.com` domain

## Related

- [[server-architecture|Server Architecture]] — Layered backend pattern (Repository → Service → tRPC)
- [[logging|Logging Guide]] — Server logging with pino
- [[lambda-development|Lambda Development]] — Background job worker patterns
- [[background-jobs|Background Jobs Runbook]] — SQS operations and DLQ inspection
