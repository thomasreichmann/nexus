# Recording captures (demo GIF / MP4)

The README walkthrough — `.github/assets/demo.gif` and its source `demo.mp4` —
is **generated from code**, not hand-recorded. The tooling lives in
`tooling/capture` (`@nexus/capture`): a scene drives a real browser through the
app and the runner records it, so a clip can be regenerated after a UI change
instead of going stale.

## Refresh the README walkthrough

```bash
pnpm dev                       # have a dev server running (the tool reuses it)
pnpm capture files-walkthrough # writes .github/assets/demo.gif + demo.mp4
```

Then commit the regenerated assets. `pnpm capture --list` shows the scenes.

### Prerequisites

- **ffmpeg + gifski** — the encoders. `brew install ffmpeg gifski`.
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
| `--mp4` / —    | the `files-walkthrough` scene writes both by default        |
| `--width=N`    | override output width                                       |
| `--fps=N`      | override frame rate                                         |
| `--speed=N`    | playback speed multiplier                                   |
| `--quality=N`  | gifski quality 1-100                                        |
| `--keep-video` | keep the raw `.webm` under `tooling/capture/.tmp/`          |

## Adding a scene

A scene is one file under `tooling/capture/src/scenes/`, registered in
`scenes/index.ts`. It has a `setup` (seed state before the browser opens, so its
time is never in the clip) and a `record` (drive the UI via the `Stage`):

```ts
export default defineScene<void>({
    name: 'my-scene', // kebab-case; becomes the asset basename
    description: '...',
    output: { gif: true, mp4: true, name: 'demo' /* override basename */ },
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
click), `type`. `stage.raw` is the underlying Playwright `Page` for anything
else.

## Gotchas

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
- **A GIF of a scroll is heavy.** GIF has no interframe compression, so the
  full-frame motion of a scroll costs far more than a static UI — the same clip
  is ~800KB as a GIF and ~500KB as an MP4. The scene trims GIF resolution /
  quality (760px, 12fps, q60) to stay under ~800KB; the MP4 stays crisp at
  1000px. GitHub doesn't autoplay `<video>` in a README, which is why the README
  uses the GIF and keeps the MP4 only as the source of truth.
