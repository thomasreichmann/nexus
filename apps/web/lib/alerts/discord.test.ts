import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { DeliverableAlert } from './types';

const hoisted = vi.hoisted(() => ({
    env: { DISCORD_ALERT_WEBHOOK_URL: undefined as string | undefined },
}));

vi.mock('@/lib/env', () => ({ env: hoisted.env }));

const { DISCORD_LIMITS, buildDiscordPayload, discordTransport, truncate } =
    await import('./discord');

function makeAlert(
    overrides: Partial<DeliverableAlert> = {}
): DeliverableAlert {
    return {
        severity: 'error',
        title: 'stripe webhook failed',
        message: 'Marking event as failed after handler threw.',
        environment: 'production',
        ...overrides,
    };
}

describe('buildDiscordPayload', () => {
    it.each([
        ['info', 0x3b82f6, 'ℹ️'],
        ['warning', 0xf59e0b, '⚠️'],
        ['error', 0xef4444, '🔴'],
        ['critical', 0x991b1b, '🚨'],
    ] as const)('maps %s to its color and emoji', (severity, color, emoji) => {
        const payload = buildDiscordPayload(makeAlert({ severity }));

        expect(payload.embeds[0].color).toBe(color);
        expect(payload.embeds[0].title).toBe(`${emoji} stripe webhook failed`);
    });

    it('formats the content line as [env] severity: title', () => {
        const payload = buildDiscordPayload(makeAlert());

        expect(payload.content).toBe(
            '[production] error: stripe webhook failed'
        );
    });

    it('prepends @here to the content line for critical only', () => {
        const critical = buildDiscordPayload(
            makeAlert({ severity: 'critical' })
        );
        expect(critical.content).toBe(
            '@here [production] critical: stripe webhook failed'
        );

        for (const severity of ['info', 'warning', 'error'] as const) {
            const payload = buildDiscordPayload(makeAlert({ severity }));
            expect(payload.content).not.toContain('@here');
        }
    });

    it('posts under a consistent username with footer and timestamp', () => {
        const payload = buildDiscordPayload(makeAlert());

        expect(payload.username).toBe('Nexus Alerts');
        expect(payload.embeds[0].footer.text).toBe('nexus · lib/alerts');
        expect(payload.embeds[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('renders environment and short context values as inline fields', () => {
        const payload = buildDiscordPayload(
            makeAlert({
                context: { source: 'stripe', eventType: 'invoice.paid' },
            })
        );

        expect(payload.embeds[0].fields).toEqual([
            { name: 'Environment', value: 'production', inline: true },
            { name: 'Source', value: 'stripe', inline: true },
            { name: 'Event type', value: 'invoice.paid', inline: true },
        ]);
    });

    it('renders the error context key full-width in a code block', () => {
        const payload = buildDiscordPayload(
            makeAlert({ context: { error: 'TRPCError: NOT_FOUND' } })
        );

        const errorField = payload.embeds[0].fields.find(
            (field) => field.name === 'Error'
        );
        expect(errorField).toEqual({
            name: 'Error',
            value: '```\nTRPCError: NOT_FOUND\n```',
            inline: false,
        });
    });

    it('truncates the title to 256 chars with an ellipsis marker', () => {
        const payload = buildDiscordPayload(
            makeAlert({ title: 'x'.repeat(300) })
        );

        expect(payload.embeds[0].title).toHaveLength(DISCORD_LIMITS.title);
        expect(payload.embeds[0].title.endsWith('…')).toBe(true);
    });

    it('truncates the description to 4096 chars', () => {
        const payload = buildDiscordPayload(
            makeAlert({ message: 'x'.repeat(5000) })
        );

        expect(payload.embeds[0].description).toHaveLength(
            DISCORD_LIMITS.description
        );
        expect(payload.embeds[0].description.endsWith('…')).toBe(true);
    });

    it('truncates field values to 1024 chars, including code-block fences', () => {
        const payload = buildDiscordPayload(
            makeAlert({
                context: { source: 'y'.repeat(2000), error: 'x'.repeat(2000) },
            })
        );

        for (const field of payload.embeds[0].fields) {
            expect(field.value.length).toBeLessThanOrEqual(
                DISCORD_LIMITS.fieldValue
            );
        }
        const errorField = payload.embeds[0].fields.find(
            (field) => field.name === 'Error'
        );
        expect(errorField?.value.startsWith('```\n')).toBe(true);
        expect(errorField?.value.endsWith('\n```')).toBe(true);
        expect(errorField?.value).toContain('…');
    });

    it('truncates the content line to 2000 chars', () => {
        const payload = buildDiscordPayload(
            makeAlert({ title: 'x'.repeat(3000) })
        );

        expect(payload.content).toHaveLength(DISCORD_LIMITS.content);
        expect(payload.content.endsWith('…')).toBe(true);
    });

    it('fits the 6000-char embed total by shrinking the description first', () => {
        const payload = buildDiscordPayload(
            makeAlert({
                title: 'x'.repeat(300),
                message: 'y'.repeat(5000),
                context: {
                    source: 'a'.repeat(2000),
                    eventType: 'b'.repeat(2000),
                    error: 'c'.repeat(2000),
                },
            })
        );

        const embed = payload.embeds[0];
        const total =
            embed.title.length +
            embed.description.length +
            embed.footer.text.length +
            embed.fields.reduce(
                (sum, field) => sum + field.name.length + field.value.length,
                0
            );
        expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.total);
        // The identifying fields survive; the prose absorbed the cut.
        expect(embed.fields.length).toBe(4);
        expect(embed.description.length).toBeLessThan(5000);
    });
});

describe('truncate', () => {
    it('returns short strings unchanged', () => {
        expect(truncate('hello', 10)).toBe('hello');
    });

    it('clips to the limit with a trailing ellipsis', () => {
        expect(truncate('hello world', 5)).toBe('hell…');
        expect(truncate('hello world', 5)).toHaveLength(5);
    });
});

describe('discordTransport', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
        hoisted.env.DISCORD_ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        hoisted.env.DISCORD_ALERT_WEBHOOK_URL = undefined;
    });

    it('is unconfigured when the webhook URL env var is unset', () => {
        hoisted.env.DISCORD_ALERT_WEBHOOK_URL = undefined;

        expect(discordTransport.isConfigured()).toBe(false);
    });

    it('POSTs the built payload to the configured webhook URL', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await discordTransport.send(makeAlert());

        expect(fetchMock).toHaveBeenCalledWith(
            'https://discord.test/webhook',
            expect.objectContaining({ method: 'POST' })
        );
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.content).toBe('[production] error: stripe webhook failed');
    });

    it('throws on a non-ok response so the dispatcher can log it', async () => {
        fetchMock.mockResolvedValue(
            new Response('Invalid Webhook Token', { status: 401 })
        );

        await expect(discordTransport.send(makeAlert())).rejects.toThrow(
            'Discord webhook responded 401'
        );
    });
});
