'use server';

import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { revalidatePath } from 'next/cache';

export async function addRandomUser() {
    const randomId = Math.random().toString(36).substring(2, 8);
    await db.insert(users).values({
        email: `user-${randomId}@example.com`,
    });
    revalidatePath('/');
}
