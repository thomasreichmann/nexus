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
});
