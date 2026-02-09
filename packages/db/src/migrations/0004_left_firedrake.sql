CREATE TABLE "storage_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "storage_usage_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "storage_usage" ADD CONSTRAINT "storage_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_usage_user_id_idx" ON "storage_usage" USING btree ("user_id");