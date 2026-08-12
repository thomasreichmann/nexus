#!/usr/bin/env bash
# Build the worker's perl + exiftool Lambda layer zip from pinned upstream
# sources. exiftool is pure perl and the AL2023 Node runtimes don't ship
# perl, so the layer carries both (shogo82148's AL2023 perl runtime layers
# are the reference approach — we build our own, no third-party ARNs).
#
# Must run inside amazonlinux:2023 — see build-ffmpeg-layer.sh for why and
# for the local docker invocation. CI entry point: lambda-layers.yml.
#
# Output: <out-dir>/exiftool-<version>-perl-<version>.zip, mounting as
# /opt/perl/... + /opt/exiftool/... . Worker invocation:
#   /opt/perl/bin/perl /opt/exiftool/exiftool
#
# Version bumps: update the pins here AND the matching locals in
# infra/terraform/layers.tf (the s3 key embeds the versions).
set -euo pipefail

PERL_VERSION=5.40.0
EXIFTOOL_VERSION=13.59

PERL_SHA256=c740348f357396327a9795d3e8323bafd0fe8a5c7835fc1cbaba0cc8dfe7161f
EXIFTOOL_SHA256=11645f015d85a56d3090ff04fbf0b07b6a8f7ee941dd93186e32985f3fd6d041

MAX_UNZIPPED_MB=80

OUT_DIR="$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)"
BUILD=/tmp/exiftool-layer-build
ROOT="$BUILD/root" # staged layer content; zip root maps to /opt
JOBS="$(nproc)"

mkdir -p "$BUILD" "$ROOT/opt"

dnf install -y --setopt=install_weak_deps=False \
    gcc make tar gzip zip patch >/dev/null

fetch() { # <url> <sha256> <output>
    curl -fsSL --retry 3 -o "$3" "$1"
    echo "$2  $3" | sha256sum -c -
}

cd "$BUILD"
fetch "https://www.cpan.org/src/5.0/perl-$PERL_VERSION.tar.gz" "$PERL_SHA256" perl.tar.gz
fetch "https://exiftool.org/Image-ExifTool-$EXIFTOOL_VERSION.tar.gz" "$EXIFTOOL_SHA256" exiftool.tar.gz

# Prefix matches the layer mount point (/opt/perl), and relocatable @INC is
# kept as insurance so the interpreter also works from the DESTDIR staging
# area (used by the smoke test below). No threads: exiftool doesn't need
# them and the build is smaller without.
tar xf perl.tar.gz
(
    cd "perl-$PERL_VERSION"
    ./Configure -des -Dprefix=/opt/perl -Duserelocatableinc \
        -Dman1dir=none -Dman3dir=none >/dev/null
    make -j"$JOBS" >/dev/null
    make install DESTDIR="$ROOT" >/dev/null
)

# Docs don't belong in a Lambda layer.
find "$ROOT/opt/perl" -name '*.pod' -delete

tar xf exiftool.tar.gz
mkdir -p "$ROOT/opt/exiftool"
cp "Image-ExifTool-$EXIFTOOL_VERSION/exiftool" "$ROOT/opt/exiftool/"
cp -r "Image-ExifTool-$EXIFTOOL_VERSION/lib" "$ROOT/opt/exiftool/"

# Smoke test with the staged interpreter — the build container is the same
# AL2023 the Lambda runtime uses.
version_output="$("$ROOT/opt/perl/bin/perl" "$ROOT/opt/exiftool/exiftool" -ver)"
if [ "$version_output" != "$EXIFTOOL_VERSION" ]; then
    echo "exiftool smoke test failed: got '$version_output', want '$EXIFTOOL_VERSION'" >&2
    exit 1
fi

total_mb="$(du -sm "$ROOT/opt" | cut -f1)"
if [ "$total_mb" -gt "$MAX_UNZIPPED_MB" ]; then
    echo "exiftool layer is ${total_mb}MB unzipped (cap ${MAX_UNZIPPED_MB}MB)" >&2
    exit 1
fi

ZIP="$OUT_DIR/exiftool-$EXIFTOOL_VERSION-perl-$PERL_VERSION.zip"
rm -f "$ZIP"
(cd "$ROOT/opt" && zip -qr9 --symlinks "$ZIP" perl exiftool)

echo "built $ZIP (${total_mb}MB unzipped)"
sha256sum "$ZIP"
