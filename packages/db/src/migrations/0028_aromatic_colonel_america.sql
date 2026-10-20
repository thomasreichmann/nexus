-- #550: when each upload was confirmed, so a batch can tell the files its
-- user deleted (confirmed once, `deleted` now) from the ones that never
-- finished (`deleted` too, by the abandon path). Additive, with no backfill:
-- a file still `available` or `restoring` counts as received without one
-- (uploadBatches' IS_RECEIVED), which also covers files the old code confirms
-- between this migration and the deploy.
ALTER TABLE "files" ADD COLUMN "confirmed_at" timestamp with time zone;
