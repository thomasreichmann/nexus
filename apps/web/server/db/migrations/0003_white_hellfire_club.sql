CREATE TYPE "public"."file_status" AS ENUM('uploading', 'available', 'restoring', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."storage_tier" AS ENUM('standard', 'glacier', 'deep_archive');--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"mime_type" text,
	"s3_key" text NOT NULL,
	"storage_tier" "storage_tier" DEFAULT 'glacier' NOT NULL,
	"status" "file_status" DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "files_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_storage_tier_idx" ON "files" USING btree ("storage_tier");