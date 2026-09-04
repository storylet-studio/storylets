#!/usr/bin/env bash
# Assemble the Hamlet Unreal demo. Our plugin is the sibling ../StoryletEngine (the
# .uproject's AdditionalPluginDirectories). Patter's plugin is fetched from its PINNED
# release into the sibling ../Patterplay, never from a checkout of ../patter. The two
# bundles come from the JS client's build. FAILS rather than skips.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
PATTER_UNREAL_VERSION="0.12.0"
zip="patterplay-unreal-${PATTER_UNREAL_VERSION}.zip"
url="https://github.com/patterkit/patter/releases/download/play-unreal-v${PATTER_UNREAL_VERSION}/${zip}"
tmp="$(mktemp -d)"
curl -fsSL -o "$tmp/$zip" "$url" || { echo "build: could not fetch Patter's Unreal plugin $PATTER_UNREAL_VERSION from $url"; exit 1; }
unzip -q "$tmp/$zip" -d "$tmp/unz"
[ -f "$tmp/unz/Patterplay/Patterplay.uplugin" ] || { echo "build: $zip did not contain Patterplay/Patterplay.uplugin"; exit 1; }
rm -rf "$here/../Patterplay"; cp -R "$tmp/unz/Patterplay" "$here/../Patterplay"
mkdir -p "$here/Demos"
cp "$root/examples/storylet-dist/the-hamlet.storyletsc" "$here/Demos/hamlet.storyletsc"; cp "$root/examples/patter-dist/the_hamlet.patterc" "$here/Demos/hamlet.patterc"
echo "build: The Hamlet (Unreal) is ready: ../StoryletEngine, ../Patterplay $PATTER_UNREAL_VERSION, both bundles in Demos/"
