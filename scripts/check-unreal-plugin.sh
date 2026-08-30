#!/usr/bin/env bash
# Compile the Unreal PLUGIN (both modules) with the engine you already have.
#
# The clang TestHost covers the std-only core, and it runs in CI with no Unreal
# at all. It cannot cover StoryletEngineRuntime's UObject wrappers or
# StoryletEngineEditor's Slate panel, because those need UE headers - and those
# are the parts a refactor breaks silently. The Godot equivalent of exactly that
# gap hid a state logger that had not compiled for weeks.
#
# NO LICENCE OR SECRET IS INVOLVED, as with the Unity demo check beside this: an
# installed Unreal builds a plugin from the command line. It is simply SLOW
# (minutes), which is why it is a script you run rather than a CI step.
#
# Usage:  ./scripts/check-unreal-plugin.sh
#         UE_ROOT=/path/to/UE_5.7 ./scripts/check-unreal-plugin.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
plugin="$root/ports/unreal/StoryletEngine/StoryletEngine.uplugin"

ue="${UE_ROOT:-}"
if [ -z "$ue" ]; then
  ue="$(ls -d /Volumes/Data/Unreal/UE_* /Users/Shared/Epic\ Games/UE_* 2>/dev/null | sort -V | tail -1 || true)"
fi
uat="$ue/Engine/Build/BatchFiles/RunUAT.sh"
if [ ! -x "$uat" ]; then
  echo "check-unreal-plugin: no Unreal engine found." >&2
  echo "  Point at one: UE_ROOT=/path/to/UE_5.7 $0" >&2
  exit 2
fi

out="${TMPDIR:-/tmp}/storylets-unreal-plugin"
echo "check-unreal-plugin: $ue"
echo "  (a full plugin build; minutes, not seconds)"
rm -rf "$out"
"$uat" BuildPlugin -Plugin="$plugin" -Package="$out" -TargetPlatforms=Mac -Rocket
echo "check-unreal-plugin: both modules compile."
