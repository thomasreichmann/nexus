-- #405: the folder a file sat in, relative to the dropped folder, so camera
-- libraries (104CANON, 105CANON, each restarting at IMG_0001) keep the
-- structure that tells same-named files apart. Nullable and additive: rows
-- uploaded before it read as top-level, and the bundle deployed before this
-- merge never selects it.
ALTER TABLE "files" ADD COLUMN "subpath" text;