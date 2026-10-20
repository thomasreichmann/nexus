-- #399: how many files the Upload click put in the batch, so a batch with
-- fewer confirmed files than that is identifiable as partial. Additive and
-- nullable: the code that writes it ships with this, and batches from before
-- it simply have no expectation recorded.
ALTER TABLE "upload_batches" ADD COLUMN "expected_file_count" integer;
