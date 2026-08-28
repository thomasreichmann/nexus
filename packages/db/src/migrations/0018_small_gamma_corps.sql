-- #416: S3 owns object state.
--
-- `files.storage_tier` was a cache of S3's storage class kept in sync by the
-- S3 -> SNS -> webhook rail. That rail is gone: the column is unreliable by
-- construction (861 rows had already drifted on dev), and nothing needs a
-- stored per-file class. Storage class is now read from S3 with a HEAD at the
-- moment it matters, and the file list shows a coarse hint derived from the
-- bucket's lifecycle policy (`isProbablyCold`).
DROP INDEX "files_storage_tier_idx";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "storage_tier";--> statement-breakpoint
DROP TYPE "public"."storage_tier";--> statement-breakpoint

-- `webhook_source` gains 'cloudwatch' so the alarm rail -- the last writer of
-- 'sns' -- is filed under its producer rather than its transport. Alarm rows
-- are identifiable by the event_type the route has always written.
--
-- Done as a type swap rather than ALTER TYPE ... ADD VALUE because the new
-- value has to be *used* by the UPDATE below, and Postgres refuses to use an
-- enum value added in the same transaction (55P04). drizzle-kit runs all
-- pending migrations in one transaction, so splitting across files would not
-- help. CREATE TYPE carries no such restriction.
--
-- 'sns' survives the swap deliberately: after this it names exactly the dead
-- S3 rail, kept as the record of something that really ran, never written
-- again.
ALTER TYPE "public"."webhook_source" RENAME TO "webhook_source_old";--> statement-breakpoint
CREATE TYPE "public"."webhook_source" AS ENUM('stripe', 'sns', 'cloudwatch');--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "source" TYPE "public"."webhook_source" USING "source"::text::"public"."webhook_source";--> statement-breakpoint
DROP TYPE "public"."webhook_source_old";--> statement-breakpoint
UPDATE "webhook_events" SET "source" = 'cloudwatch' WHERE "source" = 'sns' AND "event_type" LIKE 'cloudwatch-alarm:%';
