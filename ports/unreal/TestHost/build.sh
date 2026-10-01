#!/usr/bin/env bash
# Compile the standalone C++ corpus TestHost (clang, no Unreal) and run it against the
# committed corpus.json. This is the C++ port's half of the parity contract.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$here/storyletengine_testhost"

# On a Mac whose OS is newer than the selected Xcode, clang finds the Command Line Tools'
# newer SDK but links with Xcode's older ld, which cannot read that SDK's stubs (macOS 27
# with Xcode 26.6: "arm64e.x1"). Unreal 5.7 refuses Xcode 27, so the fix is to compile
# against the SELECTED Xcode's own SDK. A caller's SDKROOT wins; Linux CI never gets here.
if [[ "$(uname)" == "Darwin" && -z "${SDKROOT:-}" ]] && command -v xcode-select >/dev/null; then
  xcode_sdk="$(xcode-select -p)/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
  if [[ -d "$xcode_sdk" ]]; then export SDKROOT="$xcode_sdk"; fi
fi

clang++ -std=c++17 -O2 -Wall -Wextra \
  -I"$here" \
  -I"$root/ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public" \
  "$here/main.cpp" -o "$out"

"$out" "$root/packages/conformance/corpus.json"
