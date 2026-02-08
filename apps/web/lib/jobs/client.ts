import { SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@/lib/env';

export const client = new SQSClient({
    region: env.AWS_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

export const queueUrl = env.SQS_QUEUE_URL;
