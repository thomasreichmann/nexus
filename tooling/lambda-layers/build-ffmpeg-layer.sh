#!/usr/bin/env bash
# Build the worker's ffmpeg Lambda layer zip from pinned upstream sources.
#
# Must run inside amazonlinux:2023 (the nodejs22.x Lambda base image) so the
# binaries link against the glibc they'll see at runtime — this builds a zip
# layer, NOT an image-based Lambda. CI entry point: lambda-layers.yml.
# Local run: docker run --rm -v "$PWD:/src" -w /src amazonlinux:2023 \
#              bash tooling/lambda-layers/build-ffmpeg-layer.sh dist
#
# Output: <out-dir>/ffmpeg-<version>-webp.zip, mounting as /opt/bin/ffmpeg +
# /opt/bin/ffprobe (/opt/bin is on the Lambda PATH).
#
# Version bumps: update the pins here AND the matching locals in
# infra/terraform/layers.tf (the s3 key embeds the version).
set -euo pipefail

FFMPEG_VERSION=7.1
LIBWEBP_VERSION=1.4.0
OPENSSL_VERSION=3.5.7

FFMPEG_SHA256=40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6
LIBWEBP_SHA256=61f873ec69e3be1b99535634340d5bde750b2e4447caa1db9f61be3fd49ab1e5
OPENSSL_SHA256=a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8

# Guard against blowing the 250MB total unzipped cap (this layer + the
# exiftool layer + the worker bundle share it).
MAX_UNZIPPED_MB=180

OUT_DIR="$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)"
BUILD=/tmp/ffmpeg-layer-build
DEPS="$BUILD/deps"
JOBS="$(nproc)"

mkdir -p "$BUILD" "$DEPS"

dnf install -y --setopt=install_weak_deps=False \
    gcc gcc-c++ make perl pkgconf zlib-devel \
    tar gzip xz bzip2 zip diffutils file >/dev/null

fetch() { # <url> <sha256> <output>
    curl -fsSL --retry 3 -o "$3" "$1"
    echo "$2  $3" | sha256sum -c -
}

cd "$BUILD"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256" ffmpeg.tar.xz
fetch "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-$LIBWEBP_VERSION.tar.gz" "$LIBWEBP_SHA256" libwebp.tar.gz
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" "$OPENSSL_SHA256" openssl.tar.gz

# libwebp: static lib only; the image-format tool deps are irrelevant here.
tar xf libwebp.tar.gz
(
    cd "libwebp-$LIBWEBP_VERSION"
    ./configure --prefix="$DEPS" --enable-static --disable-shared \
        --disable-gl --disable-sdl --disable-png --disable-jpeg \
        --disable-tiff --disable-gif >/dev/null
    make -j"$JOBS" >/dev/null
    make install >/dev/null
)

# openssl: static, for ffmpeg's https protocol (poster frames read the
# original via presigned URL; range seeks keep a 4GB clip to a few MB).
tar xf openssl.tar.gz
(
    cd "openssl-$OPENSSL_VERSION"
    ./Configure linux-x86_64 no-shared no-tests no-docs no-apps \
        --prefix="$DEPS" --libdir=lib >/dev/null
    make -j"$JOBS" >/dev/null 2>&1
    make install_sw >/dev/null
)

# ffmpeg: keep the full decoder/demuxer set (user files are arbitrary), but
# strip encoders/muxers down to what thumbnail generation emits. OpenSSL 3
# is Apache-2.0, compatible with LGPL v3 — hence --enable-version3, no GPL.
tar xf ffmpeg.tar.xz
(
    cd "ffmpeg-$FFMPEG_VERSION"
    PKG_CONFIG_PATH="$DEPS/lib/pkgconfig" ./configure \
        --prefix="$BUILD/out" \
        --pkg-config-flags="--static" \
        --extra-cflags="-I$DEPS/include" \
        --extra-ldflags="-L$DEPS/lib" \
        --extra-libs="-lpthread -lm -ldl" \
        --enable-version3 \
        --enable-libwebp \
        --enable-openssl \
        --disable-debug --disable-doc --disable-ffplay \
        --disable-encoders --enable-encoder=libwebp,mjpeg,png \
        --disable-muxers --enable-muxer=webp,image2,mjpeg,null \
        --disable-devices >/dev/null
    make -j"$JOBS" >/dev/null
    make install >/dev/null
)

mkdir -p "$BUILD/layer/bin"
cp "$BUILD/out/bin/ffmpeg" "$BUILD/out/bin/ffprobe" "$BUILD/layer/bin/"
strip "$BUILD/layer/bin/ffmpeg" "$BUILD/layer/bin/ffprobe"

# The two capabilities the worker depends on must be compiled in.
"$BUILD/layer/bin/ffmpeg" -hide_banner -encoders | grep -q libwebp
"$BUILD/layer/bin/ffmpeg" -hide_banner -protocols | grep -q https
"$BUILD/layer/bin/ffprobe" -version >/dev/null

total_mb="$(du -sm "$BUILD/layer" | cut -f1)"
if [ "$total_mb" -gt "$MAX_UNZIPPED_MB" ]; then
    echo "ffmpeg layer is ${total_mb}MB unzipped (cap ${MAX_UNZIPPED_MB}MB)" >&2
    exit 1
fi

ZIP="$OUT_DIR/ffmpeg-$FFMPEG_VERSION-webp.zip"
rm -f "$ZIP"
(cd "$BUILD/layer" && zip -qr9 "$ZIP" bin)

echo "built $ZIP (${total_mb}MB unzipped)"
sha256sum "$ZIP"
