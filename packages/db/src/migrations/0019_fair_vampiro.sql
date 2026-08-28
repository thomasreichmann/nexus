-- #422: a multi-file restore becomes a first-class entity. `retrieval_requests`
-- is the identity of one restore, `retrieval_request_items` its file set (a
-- join table because one retrieval row can be adopted by several requests —
-- `retrievals_active_file_id_idx` allows only one active retrieval per file),
-- and `retrieval_artifacts` the 1..N zips it is delivered as (#424 builds them).
--
-- Purely additive. `retrievals.batch_id` is deprecated by this change but not
-- dropped: the bundle still deployed when this migration lands writes it, so
-- the DROP COLUMN ships alone in a later PR (expand/contract, conventions.md).
CREATE TYPE "public"."retrieval_artifact_status" AS ENUM('pending', 'building', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "retrieval_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" "retrieval_artifact_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text,
	"size_bytes" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"file_id" text NOT NULL,
	"retrieval_id" text,
	"artifact_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"upload_batch_id" text,
	"tier" "retrieval_tier" DEFAULT 'standard' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retrieval_artifacts" ADD CONSTRAINT "retrieval_artifacts_request_id_retrieval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."retrieval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_request_items" ADD CONSTRAINT "retrieval_request_items_request_id_retrieval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."retrieval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_request_items" ADD CONSTRAINT "retrieval_request_items_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_request_items" ADD CONSTRAINT "retrieval_request_items_retrieval_id_retrievals_id_fk" FOREIGN KEY ("retrieval_id") REFERENCES "public"."retrievals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_request_items" ADD CONSTRAINT "retrieval_request_items_artifact_id_retrieval_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."retrieval_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_upload_batch_id_upload_batches_id_fk" FOREIGN KEY ("upload_batch_id") REFERENCES "public"."upload_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_artifacts_request_id_position_idx" ON "retrieval_artifacts" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "retrieval_artifacts_status_created_at_idx" ON "retrieval_artifacts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_request_items_request_id_file_id_idx" ON "retrieval_request_items" USING btree ("request_id","file_id");--> statement-breakpoint
CREATE INDEX "retrieval_request_items_retrieval_id_idx" ON "retrieval_request_items" USING btree ("retrieval_id");--> statement-breakpoint
CREATE INDEX "retrieval_request_items_artifact_id_idx" ON "retrieval_request_items" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "retrieval_requests_user_id_created_at_idx" ON "retrieval_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retrieval_requests_upload_batch_id_idx" ON "retrieval_requests" USING btree ("upload_batch_id");