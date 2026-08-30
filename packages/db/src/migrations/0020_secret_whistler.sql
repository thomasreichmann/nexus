-- #423: restores default to the Bulk tier. The all-Standard behavior this
-- replaces was an unrevisited zod default at 8x the price the pricing model
-- always assumed ($0.02/GB vs $0.0025/GB), never a decision — see #406.
--
-- Not destructive and not order-sensitive: changing a column DEFAULT rewrites
-- no rows and leaves both enum values valid, so the bundle deployed before this
-- merge (which always writes `tier` explicitly) and the one after it are equally
-- happy. Existing rows keep the tier their restore actually ran at.
ALTER TABLE "retrieval_requests" ALTER COLUMN "tier" SET DEFAULT 'bulk';--> statement-breakpoint
ALTER TABLE "retrievals" ALTER COLUMN "tier" SET DEFAULT 'bulk';