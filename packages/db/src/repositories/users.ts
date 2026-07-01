import { eq } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type User = typeof schema.user.$inferSelect;
export type NewUser = typeof schema.user.$inferInsert;

function findById(db: DB, id: string): Promise<User | undefined> {
    return db.query.user.findFirst({
        where: eq(schema.user.id, id),
    });
}

export const createUserRepo = createRepository({
    findById,
});

export type UserRepo = ReturnType<typeof createUserRepo>;
