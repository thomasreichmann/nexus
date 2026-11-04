# Demo thumbnails

The photos the capture tool's demo library shows (`src/seed.ts`), served to the
recording browser in place of the derived bucket (`src/thumbnails.ts`).

They are real event photography by Thomas's mother, a professional
photographer, used with her permission for this project's README captures.
They are **not** covered by the repository's ISC license; don't reuse them
elsewhere.

They were picked to show no people's faces and no brand logos. Keep that rule
when adding or swapping one: 512px longest edge, WebP, no metadata
(`cwebp -q 80 -metadata none`), matching what the thumbnail worker produces.
