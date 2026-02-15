CREATE TYPE "public"."webhook_source" AS ENUM('stripe', 'sns');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "webhook_source" NOT NULL,
	"external_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_external_id_idx" ON "webhook_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_created_at_idx" ON "webhook_events" USING btree ("status","created_at");