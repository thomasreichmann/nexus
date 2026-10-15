-- #455: natural filename order in SQL (IMG_9.JPG before IMG_10.JPG), so the
-- file browser can page a batch's files in the order cameras write them
-- instead of sorting the whole library in JS (`compareFilesByName`, #404).
--
-- ICU's numeric collation, the same algorithm `Intl.Collator('en',
-- { numeric: true })` runs in JS. It's deterministic (the default: Postgres
-- breaks an ICU tie on the bytes), so two different names never compare equal
-- and a keyset cursor over `name COLLATE "natural"` never skips or repeats a
-- row. Additive: nothing references it until the code that does is deployed.
CREATE COLLATION IF NOT EXISTS "natural" (provider = icu, locale = 'en-u-kn-true');
