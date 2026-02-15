import MessageValidator from 'sns-validator';

const validator = new MessageValidator();

/**
 * Verify an SNS message signature.
 * Validates the certificate chain against *.amazonaws.com.
 */
export async function verifySnsMessage(
    body: Record<string, unknown>
): Promise<void> {
    return new Promise((resolve, reject) => {
        validator.validate(body, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
