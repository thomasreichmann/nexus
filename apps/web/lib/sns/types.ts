export type SnsMessageType =
    | 'SubscriptionConfirmation'
    | 'Notification'
    | 'UnsubscribeConfirmation';

interface SnsMessageBase {
    Type: SnsMessageType;
    MessageId: string;
    TopicArn: string;
    Timestamp: string;
}

export interface SnsSubscriptionConfirmation extends SnsMessageBase {
    Type: 'SubscriptionConfirmation';
    Message: string;
    SubscribeURL: string;
    Token: string;
}

export interface SnsNotification extends SnsMessageBase {
    Type: 'Notification';
    Subject?: string;
    /** JSON string; its shape is the publisher's, not SNS's. */
    Message: string;
}

export type SnsMessage = SnsSubscriptionConfirmation | SnsNotification;
