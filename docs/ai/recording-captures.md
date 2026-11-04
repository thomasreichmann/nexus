# Recording captures (demo WebP / MP4 / stills)

The README walkthrough (`.github/assets/demo.webp`, an animated WebP, and its
source `demo.mp4`)
and the library still (`files.png`) are **generated from code**, not
hand-recorded. The tooling lives in `tooling/capture` (`@nexus/capture`): a
scene drives a real browser through the app and the runner records it, so an
asset can be regenerated after a UI change instead of going stale.

## Refresh the README captures

```bash
pnpm capture files-walkthrough files-still  # demo.webp + demo.mp4, files.png
```

Then commit the regenerated assets. `pnpm capture --list` shows the scenes.
`dashboard.png` has no scene yet and is still hand-made.

## Demo thumbnails

The seeded library shows real photos: `tooling/capture/assets/thumbnails/`
(see the README there for where they come from and the no-faces / no-logos
rule). The seed marks those rows' thumbnails `ready` with the image's real
size, and the recording browser answers the app's presigned `thumb.webp`
requests from disk (`src/thumbnails.ts`). Nothing is uploaded to the derived
bucket, so there is nothing to clean up.

### Prerequisites

- **ffmpeg, img2webp, gifski** — the encoders. `brew install ffmpeg webp gifski`
  (gifski only for scenes that still write a GIF).
- **A dev server** on `http://localhost:3000` (`pnpm dev`). If none is up, the
  tool starts one and stops it after; pass `--no-server` to require an existing
  one (faster — skips the cold compile).
- **`apps/web/.env.local` with `DATABASE_URL`** (`pnpm env:pull`). The tool
  reads the same dev DB the app uses, exactly like the seed CLI and e2e.
- **Chromium for Playwright** — already present if you've run the e2e suite,
  else `pnpm -F web exec playwright install chromium`.

The tool signs up a dedicated, throwaway `capture-demo@nexus.local` user through
the BetterAuth sign-up API (off-production only), seeds **only that user's**
library, records, and deletes the user afterward — the shared admin/regular e2e
users are never touched.

### Flags

| Flag           | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `--no-server`  | fail instead of starting a dev server (reuse a running one) |
| `--no-gif`     | skip the GIF (e.g. with nothing else → error)               |
| `--webp`       | also write an animated WebP                                 |
| `--mp4`        | also write an MP4                                           |
| `--width=N`    | override output width                                       |
| `--fps=N`      | override frame rate                                         |
| `--speed=N`    | playback speed multiplier                                   |
| `--quality=N`  | gifski / img2webp quality 1-100                             |
| `--keep-video` | keep the raw `.webm` under `tooling/capture/.tmp/`          |

## Adding a scene

A scene is one file under `tooling/capture/src/scenes/`, registered in
`scenes/index.ts`. It has a `setup` (seed state before the browser opens, so its
time is never in the clip) and a `record` (drive the UI via the `Stage`):

```ts
export default defineScene<void>({
    name: 'my-scene', // kebab-case; becomes the asset basename
    description: '...',
    output: { webp: true, mp4: true, name: 'demo' /* override basename */ },
    setup: async (ctx) => {
        await ctx.seedDemoLibrary();
    },
    record: async (stage) => {
        const page = stage.raw;
        await stage.goto('/dashboard/files');
        await stage.waitFor('text=Client Deliverables — Q2 2026');
        await stage.settle();
        await stage.moveClick(
            page.getByRole('button', { name: 'Select foo.pdf' })
        );
        await stage.move(
            page.getByRole('button', { name: 'Retrieve', exact: true })
        );
    },
});
```

`Stage` drives a fake cursor (Playwright's video doesn't capture the real
pointer) and auto-trims the load/settle head up to just before the first action.
Key methods: `goto`, `waitFor`, `settle`, `pause`, `moveClick`, `move` (hover, no
click), `type`, `still`. `stage.raw` is the underlying Playwright `Page` for
anything else.

For a still, set `output: { still: true }` (no video is recorded) and call
`stage.still('name')` in `record`. It writes `.github/assets/<name>.png` at 2x
with the fake cursor hidden and the real pointer parked in a corner. See
`scenes/files-still.ts`.

## Gotchas

- **Warm up before the first action.** Anything before the first
  `move`/`moveClick` is trimmed off, so do route compiles and slow queries
  there. Reach the starting page by client-side navigation (a link click), not
  `goto`, or the query cache is thrown away. `files-walkthrough` shows the
  pattern. To wait for a page's data, wait for no `.animate-pulse`: only the
  shared `<Skeleton>` uses it.
- **Never scroll with `scrollIntoViewIfNeeded()`.** It snaps the scroll position
  in a single frame, which on a recording reads as a hard splice / teleport.
  `Stage` scrolls by easing `scrollTop` over several frames so the list moves
  under the cursor like a real wheel scroll — every `moveClick` / `move` does
  this for you. If you reach into `stage.raw` and scroll yourself, ease it.
- **No named inner functions inside `page.evaluate` callbacks.** tsx/esbuild's
  `keepNames` wraps them in a `__name()` helper that doesn't exist once the
  function is serialized into the browser (`ReferenceError: __name is not
defined`). Keep evaluate bodies free of `const fn = () => …`; do that work in
  Node instead (see `Stage.smoothScrollIntoView`).
- **Animated WebP, not GIF, for the README.** GitHub doesn't autoplay
  `<video>` in a README, so the walkthrough has to be an animated image. GIF's
  256-colour palette bands and dithers photos: at q60 / 760px (~800KB) the
  thumbnails were visibly blotchy, and q90 cost 2.5MB and still fringed text.
  An animated WebP at q75 / 1000px is ~850KB with clean photos and text. The
  MP4 stays as the source of truth.
