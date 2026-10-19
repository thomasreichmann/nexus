import { sql } from 'drizzle-orm';
import {
    describe,
    expect,
    inRolledBackTransaction,
    it,
} from '../test-db/integration';
import * as schema from './index';

describe('timestamps()', () => {
    // A plain `timestamp` stores `now()` as the inserting session's wall-clock
    // reading, and drizzle reads every such value back as UTC: a row stamped
    // from a session three hours behind UTC came back three hours early
    // (#488). Every deployed database runs its sessions in UTC, which is what
    // hid it; this one pins the session elsewhere on purpose.
    it('reads a row stamped by now() in a non-UTC session back as that instant', async ({
        db,
        user,
    }) => {
        await inRolledBackTransaction(db, async (tx) => {
            await tx.execute(sql`set local time zone 'America/Sao_Paulo'`);

            // now() is the transaction's start, so the insert below gets this
            // exact value. The text carries the session's offset (`-03`),
            // which Date parses to the instant itself.
            const [clock] = await tx.execute<{ now: string }>(
                sql`select now()::text as now`
            );
            const [batch] = await tx
                .insert(schema.uploadBatches)
                .values({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    name: 'stamped by the database',
                })
                .returning();

            expect(batch!.createdAt).toEqual(new Date(clock!.now));
        });
    });
});
