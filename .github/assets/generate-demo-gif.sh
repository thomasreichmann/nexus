#!/usr/bin/env bash
#
# Regenerate .github/assets/demo.gif from demo.mp4.
#
# Why this exists: the README walkthrough has to be a GIF, because GitHub does
# not autoplay <video> tags in rendered markdown. But a naive `ffmpeg in.mp4
# out.gif` produces a ~3.8MB file — GIF stores every frame near-whole at 256
# colors with weak per-frame compression, where H.264 only stores interframe
# deltas (the same clip is 174KB as MP4). The fix is three levers: encode with
# gifski (a purpose-built GIF encoder, far better quality-per-byte than ffmpeg's
# palettegen), cap the framerate at 12fps, and hold the width at 760px. That
# lands ~586KB — small enough to load fast and autoplay on the README.
#
# Source of truth is demo.mp4. Edit/re-record that, then run this to rebuild the GIF.
#
# Requires: ffmpeg, gifski  (macOS: `brew install ffmpeg gifski`)

set -euo pipefail

cd "$(dirname "$0")"

SRC="demo.mp4"
OUT="demo.gif"
WIDTH=760
FPS=12
QUALITY=80   # gifski quality 1-100; 80 is the sweet spot for this flat dark UI

for bin in ffmpeg gifski; do
  command -v "$bin" >/dev/null || { echo "error: '$bin' not found — brew install ffmpeg gifski" >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Downsample to target fps/width once, then let gifski build the palette + encode.
ffmpeg -y -v error -i "$SRC" -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos" "$TMP/f%04d.png"
gifski --fps "$FPS" --width "$WIDTH" --quality "$QUALITY" -o "$OUT" "$TMP"/f*.png

echo "wrote $OUT ($(du -h "$OUT" | cut -f1)) from $SRC"
