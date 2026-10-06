import { describe, expect, it } from 'vitest';
import { serverSchema } from './schema';

describe('serverSchema', () => {
    describe('SNS_OPS_ALERTS_TOPIC_ARN', () => {
        const topicArn = serverSchema.shape.SNS_OPS_ALERTS_TOPIC_ARN;
        const arn = 'arn:aws:sns:us-east-1:391615358272:nexus-ops-alerts-prod';

        // The cloudwatch-alarm route compares this for exact equality, so a
        // stray newline from a Vercel paste would reject every real alarm.
        it('trims surrounding whitespace', () => {
            expect(topicArn.parse(`${arn}\n`)).toBe(arn);
            expect(topicArn.parse(`  ${arn}\r\n`)).toBe(arn);
        });

        it('stays optional', () => {
            expect(topicArn.parse(undefined)).toBeUndefined();
        });
    });

    describe('CLOUDFRONT_FILES_DOMAIN', () => {
        const domain = serverSchema.shape.CLOUDFRONT_FILES_DOMAIN;

        it('takes a bare hostname, trimmed', () => {
            expect(domain.parse(' d37re86bcgtedj.cloudfront.net\n')).toBe(
                'd37re86bcgtedj.cloudfront.net'
            );
        });

        // The signer prepends https:// itself.
        it.each(['https://d1.cloudfront.net', 'd1.cloudfront.net/path', ''])(
            'rejects %j',
            (value) => {
                expect(domain.safeParse(value).success).toBe(false);
            }
        );
    });

    describe('CLOUDFRONT_PRIVATE_KEY', () => {
        const privateKey = serverSchema.shape.CLOUDFRONT_PRIVATE_KEY;

        it('turns literal \\n escapes back into the newlines a PEM needs', () => {
            expect(
                privateKey.parse('-----BEGIN-----\\nabc\\n-----END-----')
            ).toBe('-----BEGIN-----\nabc\n-----END-----');
        });
    });
});
