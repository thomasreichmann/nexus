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

# exiftool comes from CPAN, not exiftool.org: the site only hosts the
# current (often development) tarball and rotates it out within days, which
# 404s any pinned URL. CPAN archives every production release permanently.
PERL_VERSION=5.40.0
EXIFTOOL_VERSION=13.55
# Bump when the layer CONTENT changes without a tool-version bump (the s3
# key embeds it, and a new key is what makes Terraform publish a new layer
# version). r2: bundled libcrypt.so.2.
LAYER_REVISION=2

PERL_SHA256=c740348f357396327a9795d3e8323bafd0fe8a5c7835fc1cbaba0cc8dfe7161f
EXIFTOOL_SHA256=5f4c81d34ad406538c2871ad72dbfceb5d9b412b2f16cbbeb4d712d270846667

MAX_UNZIPPED_MB=80

OUT_DIR="$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)"
BUILD=/tmp/exiftool-layer-build
ROOT="$BUILD/root" # staged layer content; zip root maps to /opt
JOBS="$(nproc)"

mkdir -p "$BUILD" "$ROOT/opt"

dnf install -y --setopt=install_weak_deps=False \
    gcc make tar gzip zip patch binutils >/dev/null

fetch() { # <url> <sha256> <output>
    curl -fsSL --retry 3 -o "$3" "$1"
    echo "$2  $3" | sha256sum -c -
}

BUILD_LOG="$BUILD/build.log"

# Build steps log to a file so green runs stay quiet; on failure the tail is
# printed — a silently suppressed configure/make error is undebuggable in CI.
run_logged() { # <label> <cmd...>
    local label="$1"
    shift
    if ! "$@" >>"$BUILD_LOG" 2>&1; then
        echo "--- $label failed; last 100 log lines ---" >&2
        tail -100 "$BUILD_LOG" >&2
        exit 1
    fi
}

cd "$BUILD"
fetch "https://www.cpan.org/src/5.0/perl-$PERL_VERSION.tar.gz" "$PERL_SHA256" perl.tar.gz
fetch "https://cpan.metacpan.org/authors/id/E/EX/EXIFTOOL/Image-ExifTool-$EXIFTOOL_VERSION.tar.gz" "$EXIFTOOL_SHA256" exiftool.tar.gz

# Prefix matches the layer mount point (/opt/perl), and relocatable @INC is
# kept as insurance so the interpreter also works from the DESTDIR staging
# area (used by the smoke test below). No threads: exiftool doesn't need
# them and the build is smaller without.
tar xf perl.tar.gz
(
    cd "perl-$PERL_VERSION"
    run_logged "perl Configure" ./Configure -des -Dprefix=/opt/perl \
        -Duserelocatableinc -Dman1dir=none -Dman3dir=none
    run_logged "perl make" make -j"$JOBS"
    run_logged "perl install" make install DESTDIR="$ROOT"
)

# Docs don't belong in a Lambda layer.
find "$ROOT/opt/perl" -name '*.pod' -delete

# The nodejs22.x Lambda runtime is a TRIMMED AL2023: perl's libcrypt.so.2
# dependency exists in this full build container but not in the runtime,
# where its absence makes perl exit 127 at the dynamic-linker stage. Bundle
# it — /opt/lib is on the runtime's LD_LIBRARY_PATH.
mkdir -p "$ROOT/opt/lib"
cp -a /usr/lib64/libcrypt.so.2* "$ROOT/opt/lib/"

# Guard the whole class of bug: every dynamic dependency of every ELF in
# the layer must be present in the trimmed runtime (allowlist verified
# against public.ecr.aws/lambda/nodejs:22) or bundled in lib/. The plain
# smoke test below can't catch a miss — the build container resolves
# system-wide what the runtime doesn't ship.
RUNTIME_LIBS='libc.so.6 libm.so.6 libz.so.1'
check_runtime_deps() { # <elf-file...>
    local bin lib ok
    for bin in "$@"; do
        for lib in $(objdump -p "$bin" 2>/dev/null | awk '/NEEDED/{print $2}'); do
            ok=false
            case " $RUNTIME_LIBS " in *" $lib "*) ok=true ;; esac
            [ -e "$ROOT/opt/lib/$lib" ] && ok=true
            if [ "$ok" = false ]; then
                echo "$bin needs $lib: absent from the Lambda runtime and not bundled in lib/" >&2
                exit 1
            fi
        done
    done
}
check_runtime_deps "$ROOT/opt/perl/bin/perl"
while IFS= read -r so; do
    check_runtime_deps "$so"
done < <(find "$ROOT/opt/perl" -name '*.so')

tar xf exiftool.tar.gz
mkdir -p "$ROOT/opt/exiftool"
cp "Image-ExifTool-$EXIFTOOL_VERSION/exiftool" "$ROOT/opt/exiftool/"
cp -r "Image-ExifTool-$EXIFTOOL_VERSION/lib" "$ROOT/opt/exiftool/"

# Smoke test with the staged interpreter, resolving shared libs the way the
# runtime will (bundled lib/ first).
version_output="$(LD_LIBRARY_PATH="$ROOT/opt/lib" "$ROOT/opt/perl/bin/perl" "$ROOT/opt/exiftool/exiftool" -ver)"
if [ "$version_output" != "$EXIFTOOL_VERSION" ]; then
    echo "exiftool smoke test failed: got '$version_output', want '$EXIFTOOL_VERSION'" >&2
    exit 1
fi

total_mb="$(du -sm "$ROOT/opt" | cut -f1)"
if [ "$total_mb" -gt "$MAX_UNZIPPED_MB" ]; then
    echo "exiftool layer is ${total_mb}MB unzipped (cap ${MAX_UNZIPPED_MB}MB)" >&2
    exit 1
fi

ZIP="$OUT_DIR/exiftool-$EXIFTOOL_VERSION-perl-$PERL_VERSION-r$LAYER_REVISION.zip"
rm -f "$ZIP"
(cd "$ROOT/opt" && zip -qr9 --symlinks "$ZIP" perl exiftool lib)

echo "built $ZIP (${total_mb}MB unzipped)"
sha256sum "$ZIP"
