import { it, expect, describe } from '../test-db/integration';
import { createWebhookRepo } from './webhooks';

// `webhook_events` rows belong to no user: `createWebhookEvent` deletes each
// row after its test. The two sweeps scan the whole table, so each test tags
// its rows with an `eventType` prefix of its own and reads back only those,
// labelled by the suffix. Their rows are dated around 2001-01-01, where no
// real delivery is, and before any window the real health sweep's stranded
// check asks about.
const runTag = () => `test.${crypto.randomUUID()}`;
const labelsOf = (tag: string, rows: { eventType: string }[]) =>
    rows
        .filter((r) => r.eventType.startsWith(`${tag}.`))
        .map((r) => r.eventType.slice(tag.length + 1))
        .sort();

const BOUND = new Date('2001-01-01T00:00:00Z');
const at = (offsetMs: number) => new Date(BOUND.getTime() + offsetMs);
const HOUR_MS = 60 * 60 * 1000;

describe.concurrent('webhooks repository', () => {
    // The Stripe and CloudWatch routes' idempotency lookup: a redelivery must
    // find its own row, and only its own.
    it('find matches on source and external id together', async ({
        db,
        createWebhookEvent,
    }) => {
        const externalId = `evt_test_${crypto.randomUUID()}`;
        // Seeded first, so a lookup that ignored the external id would find it.
        await createWebhookEvent({ source: 'stripe' });
        const stripe = await createWebhookEvent({
            source: 'stripe',
            externalId,
        });
        const cloudwatch = await createWebhookEvent({
            source: 'cloudwatch',
            externalId,
        });
        const repo = createWebhookRepo(db);

        expect((await repo.find('stripe', externalId))?.id).toBe(stripe.id);
        expect((await repo.find('cloudwatch', externalId))?.id).toBe(
            cloudwatch.id
        );
        expect(await repo.find('sns', externalId)).toBeUndefined();
    });

    it('update writes status and error to the named event only, and returns undefined for a missing one', async ({
        db,
        createWebhookEvent,
    }) => {
        const [target, bystander] = await Promise.all([
            createWebhookEvent(),
            createWebhookEvent(),
        ]);
        const repo = createWebhookRepo(db);

        const updated = await repo.update(target.id, {
            status: 'failed',
            error: 'boom',
        });

        expect(updated).toMatchObject({
            id: target.id,
            status: 'failed',
            error: 'boom',
        });
        expect(
            await repo.find(bystander.source, bystander.externalId)
        ).toMatchObject({ status: 'received', error: null });
        expect(
            await repo.update(crypto.randomUUID(), { status: 'failed' })
        ).toBeUndefined();
    });

    // `createdAfter` is inclusive: an event at exactly the window start is in.
    it('findStranded returns the source’s events in the given statuses since the window start', async ({
        db,
        createWebhookEvent,
    }) => {
        const tag = runTag();
        const seed = (
            label: string,
            source: 'stripe' | 'cloudwatch',
            status: 'failed' | 'noop' | 'processed',
            createdAt: Date
        ) =>
            createWebhookEvent({
                eventType: `${tag}.${label}`,
                source,
                status,
                createdAt,
            });
        await Promise.all([
            seed('failed-at-start', 'stripe', 'failed', BOUND),
            seed('noop-inside', 'stripe', 'noop', at(HOUR_MS)),
            seed('processed', 'stripe', 'processed', at(HOUR_MS)),
            seed('failed-before-start', 'stripe', 'failed', at(-1)),
            seed('other-source', 'cloudwatch', 'failed', at(HOUR_MS)),
        ]);

        const rows = await createWebhookRepo(db).findStranded(
            'stripe',
            ['failed', 'noop'],
            BOUND
        );

        expect(labelsOf(tag, rows)).toEqual(['failed-at-start', 'noop-inside']);
    });

    // `createdBefore` is exclusive, and both sources count: a stranded Stripe
    // delivery is the same silent hole as a CloudWatch one.
    it('findStuckAtReceived returns received events of any source created before the cutoff', async ({
        db,
        createWebhookEvent,
    }) => {
        const tag = runTag();
        const seed = (
            label: string,
            source: 'stripe' | 'cloudwatch',
            status: 'received' | 'failed',
            createdAt: Date
        ) =>
            createWebhookEvent({
                eventType: `${tag}.${label}`,
                source,
                status,
                createdAt,
            });
        await Promise.all([
            seed('stripe-before', 'stripe', 'received', at(-1)),
            seed('cloudwatch-before', 'cloudwatch', 'received', at(-HOUR_MS)),
            seed('at-cutoff', 'stripe', 'received', BOUND),
            seed('failed-before', 'stripe', 'failed', at(-HOUR_MS)),
        ]);

        const rows = await createWebhookRepo(db).findStuckAtReceived(BOUND);

        expect(labelsOf(tag, rows)).toEqual([
            'cloudwatch-before',
            'stripe-before',
        ]);
    });
});
