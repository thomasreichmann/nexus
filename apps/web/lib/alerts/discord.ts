import { env } from '@/lib/env';
import type { AlertSeverity, AlertTransport, DeliverableAlert } from './types';

/**
 * Discord hard-rejects oversized payloads with a 400, so the transport clips
 * every part to these documented limits before sending — a huge error payload
 * degrades to a truncated message, never a dropped alert.
 */
const FETCH_TIMEOUT_MS = 5000;

export const DISCORD_LIMITS = {
    content: 2000,
    title: 256,
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    /** Sum of title + description + field names/values + footer text. */
    total: 6000,
} as const;

// Emoji in the title because the embed's color bar is easy to miss and
// invisible in push notifications.
const SEVERITY_STYLES: Record<AlertSeverity, { color: number; emoji: string }> =
    {
        info: { color: 0x3b82f6, emoji: 'ℹ️' },
        warning: { color: 0xf59e0b, emoji: '⚠️' },
        error: { color: 0xef4444, emoji: '🔴' },
        critical: { color: 0x991b1b, emoji: '🚨' },
    };

interface DiscordEmbedField {
    name: string;
    value: string;
    inline: boolean;
}

interface DiscordEmbed {
    title: string;
    description: string;
    color: number;
    fields: DiscordEmbedField[];
    footer: { text: string };
    timestamp: string;
}

export interface DiscordWebhookPayload {
    username: string;
    content: string;
    embeds: [DiscordEmbed];
}

export function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

// `eventType` → `Event type`
function humanizeKey(key: string): string {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The fence chars count against the field-value limit: ```\n + \n``` = 8.
function formatCodeBlock(value: string): string {
    return `\`\`\`\n${truncate(value, DISCORD_LIMITS.fieldValue - 8)}\n\`\`\``;
}

function getEmbedLength(embed: DiscordEmbed): number {
    return (
        embed.title.length +
        embed.description.length +
        embed.footer.text.length +
        embed.fields.reduce(
            (sum, field) => sum + field.name.length + field.value.length,
            0
        )
    );
}

export function buildDiscordPayload(
    alert: DeliverableAlert
): DiscordWebhookPayload {
    const style = SEVERITY_STYLES[alert.severity];

    // The plain-text content line is what push notifications and the channel
    // list show (embeds render poorly there), and the only place mentions
    // work. @here is reserved for critical — a channel that pings for every
    // warning gets muted, which recreates the problem alerts exist to fix.
    const mention = alert.severity === 'critical' ? '@here ' : '';
    const content = truncate(
        `${mention}[${alert.environment}] ${alert.severity}: ${alert.title}`,
        DISCORD_LIMITS.content
    );

    const fields: DiscordEmbedField[] = [
        {
            name: 'Environment',
            value: truncate(alert.environment, DISCORD_LIMITS.fieldValue),
            inline: true,
        },
    ];
    for (const [key, value] of Object.entries(alert.context ?? {})) {
        if (key === 'error') {
            fields.push({
                name: 'Error',
                value: formatCodeBlock(value),
                inline: false,
            });
        } else {
            fields.push({
                name: truncate(humanizeKey(key), DISCORD_LIMITS.fieldName),
                value: truncate(value, DISCORD_LIMITS.fieldValue),
                inline: true,
            });
        }
    }

    const embed: DiscordEmbed = {
        title: truncate(`${style.emoji} ${alert.title}`, DISCORD_LIMITS.title),
        description: truncate(alert.message, DISCORD_LIMITS.description),
        color: style.color,
        fields,
        footer: { text: 'nexus · lib/alerts' },
        timestamp: new Date().toISOString(),
    };

    // Fit the 6000-char total: shrink the prose description first (the fields
    // carry the identifying facts), then drop trailing fields as a last resort.
    let excess = getEmbedLength(embed) - DISCORD_LIMITS.total;
    if (excess > 0) {
        embed.description = truncate(
            embed.description,
            Math.max(embed.description.length - excess, 1)
        );
        excess = getEmbedLength(embed) - DISCORD_LIMITS.total;
    }
    while (excess > 0 && embed.fields.length > 0) {
        embed.fields.pop();
        excess = getEmbedLength(embed) - DISCORD_LIMITS.total;
    }

    return { username: 'Nexus Alerts', content, embeds: [embed] };
}

export const discordTransport: AlertTransport = {
    name: 'discord',
    isConfigured() {
        return Boolean(env.DISCORD_ALERT_WEBHOOK_URL);
    },
    async send(alert: DeliverableAlert): Promise<void> {
        const url = env.DISCORD_ALERT_WEBHOOK_URL;
        if (!url) return;

        // Call sites await `alerts.send` inside webhook request paths, so a
        // stalled Discord endpoint must not hold up the 200 response long
        // enough for Stripe/SNS to retry the delivery.
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildDiscordPayload(alert)),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
                `Discord webhook responded ${response.status}: ${body.slice(0, 200)}`
            );
        }
    },
};
