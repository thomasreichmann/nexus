-- Backfill storage_usage from live files data so the table becomes the
-- authoritative source for quota checks. Without this, users with files but
-- no usage row would read as 0 bytes and bypass enforcement until their next
-- upload. Aggregates exclude `deleted` and `uploading` rows to match the
-- read filter used in fileRepo.sumStorageByUser.
INSERT INTO "storage_usage" ("id", "user_id", "used_bytes", "file_count")
SELECT
    gen_random_uuid()::text,
    "files"."user_id",
    COALESCE(SUM("files"."size"), 0)::bigint,
    COUNT(*)::int
FROM "files"
WHERE "files"."status" NOT IN ('deleted', 'uploading')
GROUP BY "files"."user_id"
ON CONFLICT ("user_id") DO UPDATE SET
    "used_bytes" = EXCLUDED."used_bytes",
    "file_count" = EXCLUDED."file_count",
    "updated_at" = now();
