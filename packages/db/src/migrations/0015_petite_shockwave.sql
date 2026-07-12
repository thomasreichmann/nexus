-- Existing rows can violate the index this migration creates: lapsed `ready`
-- rows (expired by read predicate, never by stored status) and duplicates
-- slipped in by the pre-constraint read-then-insert race (#266). Expire the
-- lapsed, keep the newest of any remaining active duplicates.
UPDATE "retrievals" SET "status" = 'expired', "updated_at" = now()
WHERE "status" = 'ready' AND "expires_at" IS NOT NULL AND "expires_at" <= now();--> statement-breakpoint
UPDATE "retrievals" SET "status" = 'cancelled', "updated_at" = now()
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", row_number() OVER (
            PARTITION BY "file_id"
            ORDER BY "created_at" DESC, "id" DESC
        ) AS "rn"
        FROM "retrievals"
        WHERE "status" IN ('pending', 'in_progress', 'ready')
    ) "ranked"
    WHERE "rn" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "retrievals_active_file_id_idx" ON "retrievals" USING btree ("file_id") WHERE status IN ('pending', 'in_progress', 'ready');
