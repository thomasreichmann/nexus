CREATE TYPE "public"."share_status" AS ENUM('uploading', 'ready');--> statement-breakpoint
CREATE TABLE "share_files" (
	"id" text PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"s3_key" text NOT NULL,
	"position" integer NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "share_status" DEFAULT 'uploading' NOT NULL,
	"ip_hash" text NOT NULL,
	"total_size" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_files" ADD CONSTRAINT "share_files_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_files_share_id_idx" ON "share_files" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "shares_ip_hash_created_at_idx" ON "shares" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "shares_created_at_idx" ON "shares" USING btree ("created_at");