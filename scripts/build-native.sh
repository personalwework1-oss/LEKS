#!/usr/bin/env bash
# Builds the Rust encryption core for the phones and puts it where the app's
# native module (apps/mobile/modules/leks-crypto) expects it.
#
#   scripts/build-native.sh android   # needs ANDROID_NDK_HOME (or ANDROID_NDK_LATEST_HOME)
#   scripts/build-native.sh ios       # needs macOS with Xcode
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
module="$root/apps/mobile/modules/leks-crypto"
cd "$root"

build_android() {
  local ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-}}"
  [ -n "$ndk" ] || { echo "Set ANDROID_NDK_HOME" >&2; exit 1; }
  local host
  case "$(uname -s)" in
    Linux) host=linux-x86_64 ;;
    Darwin) host=darwin-x86_64 ;;
    *) echo "unsupported host" >&2; exit 1 ;;
  esac
  local bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
  local api=26
  for pair in "aarch64-linux-android:arm64-v8a" "x86_64-linux-android:x86_64"; do
    local target="${pair%%:*}" abi="${pair##*:}"
    local upper
    upper="$(echo "$target" | tr 'a-z-' 'A-Z_')"
    export "CARGO_TARGET_${upper}_LINKER=$bin/${target}${api}-clang"
    export "CC_${target//-/_}=$bin/${target}${api}-clang"
    export "AR_${target//-/_}=$bin/llvm-ar"
    cargo build --release -p leks-crypto --target "$target"
    mkdir -p "$module/android/src/main/jniLibs/$abi"
    cp "target/$target/release/libleks_crypto.so" "$module/android/src/main/jniLibs/$abi/"
  done
  ls -lh "$module"/android/src/main/jniLibs/*/libleks_crypto.so
}

build_ios() {
  export IPHONEOS_DEPLOYMENT_TARGET=16.4
  for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
    cargo build --release -p leks-crypto --target "$target"
  done
  local sim="target/ios-sim-universal/release"
  mkdir -p "$sim"
  lipo -create target/aarch64-apple-ios-sim/release/libleks_crypto.a target/x86_64-apple-ios/release/libleks_crypto.a \
    -output "$sim/libleks_crypto.a"
  local headers
  headers="$(mktemp -d)"
  cp "$module/ios/LeksCryptoFFI.h" "$headers/"
  rm -rf "$module/ios/LeksCrypto.xcframework"
  xcodebuild -create-xcframework \
    -library target/aarch64-apple-ios/release/libleks_crypto.a -headers "$headers" \
    -library "$sim/libleks_crypto.a" -headers "$headers" \
    -output "$module/ios/LeksCrypto.xcframework"
  du -sh "$module/ios/LeksCrypto.xcframework"
}

case "${1:-}" in
  android) build_android ;;
  ios) build_ios ;;
  *) echo "usage: $0 android|ios" >&2; exit 1 ;;
esac
