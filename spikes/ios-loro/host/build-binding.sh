#!/bin/sh
# Builds loro-react-native from git with loro-ffi pinned to =1.16.2 and packs it for the app.
# Usage (on the Mac): sh host/build-binding.sh [checkout-dir] [pack-dir]
# The app consumes src/ through the package's "react-native" field, so packing skips bob's lib build.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${1:-$ROOT/loro-react-native}
PACK_DIR=${2:-$ROOT}
TOOLCHAIN=$(rustup run stable rustc --print sysroot)
export PATH="$TOOLCHAIN/bin:$PATH" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/loro-dev/loro-react-native.git "$DIR"
  git -C "$DIR" checkout 8fad8d61c11c23e7c57999533d637d316465ffc1
  git -C "$DIR" apply "$ROOT/host/loro-react-native-1.16.2.patch"
fi
[ -x "$ROOT/tools/node_modules/.bin/ubrn" ] || (mkdir -p "$ROOT/tools" && cd "$ROOT/tools" && npm init -y >/dev/null && npm install uniffi-bindgen-react-native@0.31.0-2)
cd "$DIR"
"$ROOT/tools/node_modules/.bin/ubrn" build ios --release --config ubrn.config.yaml --and-generate
./scripts/add-extension.sh
rm -f LoroReactNative.podspec
npm pack --ignore-scripts --pack-destination "$PACK_DIR"
