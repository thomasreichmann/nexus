ALTER TABLE "retrieval_requests" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "retrievals" ADD COLUMN "restore_days_to_keep" integer;