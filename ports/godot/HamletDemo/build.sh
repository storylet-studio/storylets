#!/usr/bin/env bash
# Assemble the Hamlet Godot demo: our addon from the sibling port, Patter's
# addon from its PINNED release (never a checkout of ../patter: on a runner that
# resolves to something other than what shipped), and the two compiled bundles
# from the JS client's build, which compiles both projects from their shards.
# FAILS rather than skips: a demo that opens with an addon missing teaches the
# wrong thing first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
PATTER_GODOT_VERSION="0.10.0"

rm -rf "$here/addons"; mkdir -p "$here/addons"
cp -R "$root/ports/godot/addons/storyletengine" "$here/addons/storyletengine"

zip="patterplay-godot-${PATTER_GODOT_VERSION}.zip"
url="https://github.com/patterkit/patter/releases/download/play-godot-v${PATTER_GODOT_VERSION}/${zip}"
tmp="$(mktemp -d)"
curl -fsSL -o "$tmp/$zip" "$url" || { echo "build: could not fetch Patter's Godot addon $PATTER_GODOT_VERSION from $url"; exit 1; }
unzip -q "$tmp/$zip" -d "$tmp/unz"
[ -f "$tmp/unz/patterplay/plugin.cfg" ] || { echo "build: $zip did not contain patterplay/plugin.cfg"; exit 1; }
cp -R "$tmp/unz/patterplay" "$here/addons/patterplay"

( cd "$root" && npm run build -w @storylet-studio/hamlet-client >/dev/null )
cp "$root/packages/hamlet-client/dist/hamlet.storyletsc" "$root/packages/hamlet-client/dist/hamlet.patterc" "$here/"
echo "build: The Hamlet (Godot) is ready: addons/storyletengine, addons/patterplay $PATTER_GODOT_VERSION, both bundles"
