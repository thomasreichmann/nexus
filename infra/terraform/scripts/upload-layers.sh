#!/usr/bin/env bash
# Sync CI-built Lambda layer zips into an environment's artifacts bucket so
# `terraform apply` can publish them as layer versions (see ../layers.tf).
#
# Usage:
#   gh run download --repo thomasreichmann/nexus -n ffmpeg-layer -n exiftool-layer -D /tmp/layers
#   ./upload-layers.sh dev /tmp/layers
set -euo pipefail

usage() {
    echo "usage: $0 <dev|prod> <dir-with-layer-zips>" >&2
    exit 1
}

[ $# -eq 2 ] || usage
ENV="$1"
DIR="$2"
case "$ENV" in dev | prod) ;; *) usage ;; esac

# find, not globstar: macOS ships bash 3.2, which has no globstar.
found=0
while IFS= read -r zip; do
    found=1
    aws s3 cp "$zip" "s3://nexus-lambda-artifacts-$ENV/layers/$(basename "$zip")"
done < <(find "$DIR" -name '*.zip')

if [ "$found" -eq 0 ]; then
    echo "no layer zips found under $DIR" >&2
    exit 1
fi
