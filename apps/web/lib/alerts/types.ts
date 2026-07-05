export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
    severity: AlertSeverity;
    title: string;
    message: string;
    /** Short identifying facts (source, eventType, externalId, error, …). */
    context?: Record<string, string>;
}

/** An alert enriched with the runtime environment, as handed to transports. */
export interface DeliverableAlert extends Alert {
    environment: string;
}

export interface AlertTransport {
    name: string;
    /** Unconfigured transports (e.g. missing env var) are skipped, not errors. */
    isConfigured(): boolean;
    send(alert: DeliverableAlert): Promise<void>;
}
