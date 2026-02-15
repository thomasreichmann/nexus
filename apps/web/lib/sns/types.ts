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
    Message: string; // JSON string containing S3 event records
}

export type SnsMessage = SnsSubscriptionConfirmation | SnsNotification;

export interface S3EventRecord {
    eventName: string;
    s3: {
        bucket: { name: string };
        object: { key: string; size?: number };
    };
    glacierEventData?: {
        restoreEventData: {
            lifecycleRestorationExpiryTime: string;
        };
    };
}

export interface S3EventNotification {
    Records: S3EventRecord[];
}
