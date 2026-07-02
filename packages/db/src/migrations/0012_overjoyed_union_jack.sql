CREATE TYPE "public"."invite_status" AS ENUM('pending', 'redeemed', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'sponsored';--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"email" text,
	"storage_limit" bigint,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp,
	"created_by" text NOT NULL,
	"redeemed_by_user_id" text,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_redeemed_by_user_id_user_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invites_status_idx" ON "invites" USING btree ("status");