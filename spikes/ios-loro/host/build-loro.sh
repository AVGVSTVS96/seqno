#!/bin/sh
# Rebuilds the loro-react-native static library (loro-ffi =1.16.2) with the given Rust opt-level and
# swaps it into the app's installed package. Upstream's release profile uses opt-level "z" (target/ is
# where host/build-binding.sh's ubrn build leaves that variant).
set -eu
OPT=${1:-z}
INSTALL=${2:-install}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CRATE=$ROOT/loro-react-native/loro-rs
if [ "$OPT" = z ]; then TARGET_DIR=$CRATE/target; else TARGET_DIR=$CRATE/target-opt-$OPT; fi
TOOLCHAIN=$(rustup run stable rustc --print sysroot)
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  CARGO_PROFILE_RELEASE_OPT_LEVEL=$OPT RUSTC="$TOOLCHAIN/bin/rustc" "$TOOLCHAIN/bin/cargo" build --manifest-path "$CRATE/Cargo.toml" --release --target $target --target-dir "$TARGET_DIR"
done
[ "$INSTALL" = install ] || exit 0
PKG=$ROOT/app/node_modules/loro-react-native/build
rm -rf "$PKG/LoroFfiFramework.xcframework"
xcodebuild -create-xcframework \
  -library "$TARGET_DIR/aarch64-apple-ios/release/libloro_rs.a" \
  -library "$TARGET_DIR/aarch64-apple-ios-sim/release/libloro_rs.a" \
  -output "$PKG/LoroFfiFramework.xcframework"
echo "$OPT" > "$PKG/OPT_LEVEL"
rm -rf "$ROOT/dd/Build/Products/Release-iphonesimulator/XCFrameworkIntermediates/loro-react-native"
