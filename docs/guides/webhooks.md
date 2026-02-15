---
title: Webhook Handling
created: 2026-02-15
updated: 2026-02-15
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
│   └── sns/route.ts             # AWS SNS endpoint (future)
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

```typescript
// Pattern used in the route handler
const existing = await findWebhookEvent(db, {
    source: 'stripe',
    externalId: event.id,
});

if (existing) {
    // Already processed — return 200 to stop retries
    return NextResponse.json({ received: true, duplicate: true });
}

// Insert tracking record before processing
const webhookEvent = await insertWebhookEvent(db, {
    source: 'stripe',
    externalId: event.id,
    eventType: event.type,
    payload: event,
});

// Process the event...
// On success: mark as 'processed'
// On failure: mark as 'failed' with error message
```

### Table Schema

See `packages/db/src/schema/webhooks.ts` for the full schema. Key columns:

| Column       | Purpose                                                |
| ------------ | ------------------------------------------------------ |
| `externalId` | Provider's event ID (e.g., `evt_1234` from Stripe)     |
| `source`     | Provider name (`stripe`, `sns`)                        |
| `eventType`  | Event type string (e.g., `invoice.paid`)               |
| `payload`    | Full event payload as JSONB (for debugging/replaying)  |
| `status`     | Processing status: `received` → `processed` / `failed` |
| `error`      | Error message if processing failed                     |

**Unique constraint** on `(source, external_id)` prevents duplicate inserts. If a concurrent request tries to insert the same event, the DB rejects it.

### Payload Retention & Cleanup

Webhook payloads are stored for **debugging and replay** purposes. Cleanup strategy:

- **Active retention:** 90 days — payloads available for debugging and replay
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

        await updateWebhookEvent(db, webhookEvent.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
        });

        // Return 200 to prevent retries for business logic errors.
        // Only throw (return 5xx) for truly transient failures
        // that would benefit from a retry.
        return NextResponse.json({ received: true });
    }
}
```

### When to Return 5xx

Reserve `500` for infrastructure failures where a retry would genuinely help:

- Database connection refused
- Connection timeout to a dependent service
- Out of memory / process crash (automatic — Vercel returns 500)

If you're unsure, default to `200`. You can always replay events from the `webhook_events` table.

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
curl -X POST http://localhost:3000/api/webhooks/sns \
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
curl -X POST http://localhost:3000/api/webhooks/sns \
  -H 'Content-Type: application/json' \
  -H 'x-amz-sns-message-type: Notification' \
  -d '{
    "Type": "Notification",
    "MessageId": "msg-456",
    "TopicArn": "arn:aws:sns:us-east-1:123456789:nexus-events",
    "Subject": "Amazon S3 Notification",
    "Message": "{\"Records\":[{\"eventName\":\"s3:ObjectRestore:Completed\",\"s3\":{\"bucket\":{\"name\":\"nexus-storage-files-dev\"},\"object\":{\"key\":\"user-123/file-456/document.pdf\"}}}]}"
  }'
```

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
