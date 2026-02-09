CREATE TYPE "public"."retrieval_status" AS ENUM('pending', 'in_progress', 'ready', 'expired', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."retrieval_tier" AS ENUM('standard', 'bulk', 'expedited');--> statement-breakpoint
CREATE TABLE "retrievals" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "retrieval_status" DEFAULT 'pending' NOT NULL,
	"tier" "retrieval_tier" DEFAULT 'standard' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"initiated_at" timestamp,
	"ready_at" timestamp,
	"expires_at" timestamp,
	"failed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "retrievals" ADD CONSTRAINT "retrievals_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrievals" ADD CONSTRAINT "retrievals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retrievals_file_id_idx" ON "retrievals" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "retrievals_user_id_idx" ON "retrievals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "retrievals_status_idx" ON "retrievals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "retrievals_expires_at_idx" ON "retrievals" USING btree ("expires_at");