import { describe, expect, it } from 'vitest';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { introspectRouter } from './introspect';

const t = initTRPC.create();

describe('introspectRouter', () => {
    it('extracts procedures from a simple router', () => {
        const router = t.router({
            hello: t.procedure.query(() => 'world'),
        });

        const schema = introspectRouter(router);

        expect(schema.procedures).toHaveLength(1);
        expect(schema.procedures[0]).toMatchObject({
            path: 'hello',
            type: 'query',
            inputSchema: null,
            outputSchema: null,
        });
        expect(schema.version).toBe(1);
        expect(schema.generatedAt).toBeDefined();
    });

    it('extracts input schema from procedures with Zod input', () => {
        const router = t.router({
            greet: t.procedure
                .input(z.object({ name: z.string() }))
                .query(({ input }) => `Hello, ${input.name}!`),
        });

        const schema = introspectRouter(router);

        expect(schema.procedures).toHaveLength(1);
        expect(schema.procedures[0].path).toBe('greet');
        expect(schema.procedures[0].inputSchema).toMatchObject({
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
        });
    });

    it('distinguishes between queries and mutations', () => {
        const router = t.router({
            getData: t.procedure.query(() => 'data'),
            setData: t.procedure.mutation(() => 'ok'),
        });

        const schema = introspectRouter(router);

        expect(schema.procedures).toHaveLength(2);

        const query = schema.procedures.find((p) => p.path === 'getData');
        const mutation = schema.procedures.find((p) => p.path === 'setData');

        expect(query?.type).toBe('query');
        expect(mutation?.type).toBe('mutation');
    });

    it('handles nested routers with dot notation paths', () => {
        const router = t.router({
            user: t.router({
                get: t.procedure.query(() => null),
                update: t.procedure.mutation(() => null),
            }),
            post: t.router({
                list: t.procedure.query(() => []),
            }),
        });

        const schema = introspectRouter(router);

        expect(schema.procedures).toHaveLength(3);

        const paths = schema.procedures.map((p) => p.path).sort();
        expect(paths).toEqual(['post.list', 'user.get', 'user.update']);
    });

    it('extracts complex Zod schemas', () => {
        const router = t.router({
            createUser: t.procedure
                .input(
                    z.object({
                        email: z.string().email(),
                        age: z.number().min(0).max(150).optional(),
                        role: z.enum(['admin', 'user']),
                    })
                )
                .mutation(() => null),
        });

        const schema = introspectRouter(router);
        const inputSchema = schema.procedures[0].inputSchema;

        expect(inputSchema).toMatchObject({
            type: 'object',
            properties: {
                email: { type: 'string', format: 'email' },
                age: { type: 'number', minimum: 0, maximum: 150 },
                role: { enum: ['admin', 'user'] },
            },
            required: ['email', 'role'],
        });
    });

    it('returns empty procedures array for empty router', () => {
        const router = t.router({});

        const schema = introspectRouter(router);

        expect(schema.procedures).toEqual([]);
    });

    it('sorts procedures alphabetically by path', () => {
        const router = t.router({
            zebra: t.procedure.query(() => null),
            alpha: t.procedure.query(() => null),
            middle: t.procedure.query(() => null),
        });

        const schema = introspectRouter(router);
        const paths = schema.procedures.map((p) => p.path);

        expect(paths).toEqual(['alpha', 'middle', 'zebra']);
    });
});
