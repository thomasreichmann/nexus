CREATE TYPE "public"."thumbnail_status" AS ENUM('pending', 'ready', 'failed', 'failed_cold', 'skipped');--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_status" "thumbnail_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_width" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_height" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
-- Rows predating thumbnail generation never get a job enqueued. Archived
-- originals become 'failed_cold' — the accurate state, and the one the
-- ObjectRestore:Completed self-heal regenerates on any future restore.
-- Standard-tier rows (recent uploads not yet transitioned, sub-128KB files
-- that never transition) stay 'pending': they're readable now but have no
-- restore event to self-heal off, and 'failed_cold' would be a dead end for
-- them. Deleted rows are 'skipped'; 'uploading' rows keep 'pending' since
-- confirm-upload will enqueue for them.
UPDATE "files" SET "thumbnail_status" = 'failed_cold' WHERE "status" IN ('available', 'restoring') AND "storage_tier" != 'standard';--> statement-breakpoint
UPDATE "files" SET "thumbnail_status" = 'skipped' WHERE "status" = 'deleted';