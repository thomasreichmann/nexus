-- #428: the contract half of #422, closing the loop 0019 left open.
--
-- `retrievals.batch_id` pointed at the *upload* batch, which was never the
-- identity of a restore — `requestBulkRetrieval` left it null. #422 replaced it
-- with the retrieval-request entity, where batch provenance now lives on
-- `retrieval_requests.upload_batch_id` as the selection mechanism it always
-- was. Nothing in the repo has read or written this column since; dev held
-- zero non-null values at drop time.
--
-- Ships alone per the expand/contract rule (conventions.md → DB Migrations):
-- #422 (PR #427) merged 2026-08-28 and is deployed on web and worker in both
-- dev and prod, so no live bundle references the column.
ALTER TABLE "retrievals" DROP CONSTRAINT "retrievals_batch_id_upload_batches_id_fk";
--> statement-breakpoint
DROP INDEX "retrievals_batch_id_idx";--> statement-breakpoint
ALTER TABLE "retrievals" DROP COLUMN "batch_id";