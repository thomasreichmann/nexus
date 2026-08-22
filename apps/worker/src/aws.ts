import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

/**
 * Lazily-constructed AWS clients and env access for the worker.
 *
 * Lazy so that importing a handler never requires env or AWS setup — unit
 * tests import the modules directly. Region comes from the Lambda runtime, and
 * the env vars are set by Terraform (`infra/terraform/lambda.tf`), never from
 * a `.env` file or the web app's validated `env` module.
 */
let s3Client: S3Client | undefined;
export function getS3(): S3Client {
    s3Client ??= new S3Client({});
    return s3Client;
}

let sqsClient: SQSClient | undefined;
export function getSqs(): SQSClient {
    sqsClient ??= new SQSClient({});
    return sqsClient;
}

export type WorkerEnvVar =
    | 'DATABASE_URL'
    | 'S3_BUCKET'
    | 'S3_DERIVED_BUCKET'
    | 'SQS_QUEUE_URL';

/** Reads a required Lambda env var, or throws pointing at where to set it. */
export function requireEnv(name: WorkerEnvVar): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. Configure it on the Lambda function (infra/terraform/lambda.tf).`
        );
    }
    return value;
}
