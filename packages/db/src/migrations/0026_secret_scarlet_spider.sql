-- #452: each file's path inside its restore zip, resolved once per request at
-- the partition so two same-named files in different chunks can't both
-- extract to the same path. Additive and nullable: the code that writes it
-- ships with this, and a request partitioned before it falls back to naming
-- within its chunk, as before.
ALTER TABLE "retrieval_request_items" ADD COLUMN "entry_name" text;
