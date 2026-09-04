#!/usr/bin/env bash
# Assemble the Hamlet Unity demo. Our package comes through Packages/manifest.json
# (file:../../StoryletEngine, as the Board demo does). Patter's comes from its
# PINNED release zip, unpacked under Packages/ where Unity treats a folder with a
# package.json as an embedded package: never a checkout of ../patter. The two
# bundles come from the JS client's build, which compiles both projects from
# their shards. FAILS rather than skips.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
PATTER_UNITY_VERSION="0.12.0"
zip="patterplay-unity-${PATTER_UNITY_VERSION}.zip"
url="https://github.com/patterkit/patter/releases/download/play-unity-v${PATTER_UNITY_VERSION}/${zip}"
tmp="$(mktemp -d)"
curl -fsSL -o "$tmp/$zip" "$url" || { echo "build: could not fetch Patter's Unity package $PATTER_UNITY_VERSION from $url"; exit 1; }
unzip -q "$tmp/$zip" -d "$tmp/unz"
[ -f "$tmp/unz/Patterplay/package.json" ] || { echo "build: $zip did not contain Patterplay/package.json"; exit 1; }
rm -rf "$here/Packages/Patterplay"; cp -R "$tmp/unz/Patterplay" "$here/Packages/Patterplay"
mkdir -p "$here/Assets/StreamingAssets"
cp "$root/examples/storylet-dist/the-hamlet.storyletsc" "$here/Assets/StreamingAssets/hamlet.storyletsc"; cp "$root/examples/patter-dist/the_hamlet.patterc" "$here/Assets/StreamingAssets/hamlet.patterc"
echo "build: The Hamlet (Unity) is ready: StoryletEngine via manifest, Patterplay $PATTER_UNITY_VERSION embedded, both bundles in StreamingAssets"
