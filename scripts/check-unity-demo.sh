#!/usr/bin/env bash
# Compile the Unity DEMO scripts, headlessly, with the editor you already have.
#
# The dotnet TestHost covers the Unity RUNTIME (pure C#, no editor needed, and
# it runs in CI). It cannot cover the demo, because the demo talks to
# UnityEngine - and the demo is exactly where the 2026-08-29 audit found three
# CS1503 errors sitting unnoticed: the Live Link v2 pass moved Attach from a
# flow to the engine and updated the link and the TestHost but not the demo, so
# the scene could not enter Play mode.
#
# NO LICENCE SECRET IS INVOLVED. An installed, activated Unity compiles from the
# command line, which is how those errors were found in the first place. The
# UNITY_LICENSE secret in .github/workflows/ports.yml is only for a
# GitHub-HOSTED runner, which has no Unity on it at all; a self-hosted runner on
# a machine with Unity runs this script as it stands.
#
# Usage:  ./scripts/check-unity-demo.sh          (finds the newest Hub editor)
#         UNITY_PATH=/path/to/Unity ./scripts/check-unity-demo.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
project="$root/ports/unity/StoryletEngineDemo"
log="${TMPDIR:-/tmp}/storylets-unity-demo.log"

unity="${UNITY_PATH:-}"
if [ -z "$unity" ]; then
  # Newest Hub editor. `sort -V` so 6000.4.10 beats 6000.4.6 rather than losing
  # to it alphabetically.
  unity="$(ls -d /Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ ! -x "$unity" ]; then
  echo "check-unity-demo: no Unity editor found." >&2
  echo "  Install one through Unity Hub, or point at it: UNITY_PATH=/path/to/Unity $0" >&2
  exit 2
fi

# Positive evidence of a compile, not a grep for a name. The old proof was a grep for
# `Assembly-CSharp`, and a crashed build step logs that name too ("... is not valid.
# Loading of assembly skipped"), so on 2026-09-24 this check reported success for a Unity
# that had crashed and compiled nothing. So: clear the compiled assemblies first, forcing a
# real compile, and afterwards require every one of them to exist and to be newer than the
# moment the run started.
assemblies="$project/Library/ScriptAssemblies"
expected=(StoryletEngine.Expr.dll StoryletEngine.Runtime.dll StoryletEngine.Runtime.Json.dll StoryletEngine.Runtime.Unity.dll StoryletEngine.Editor.dll StoryletEngineDemo.dll StoryletEngineDemo.Editor.dll)
rm -rf "$assemblies"
stamp="$(mktemp "${TMPDIR:-/tmp}/check-unity-demo-stamp.XXXXXX")"
# Unity's build step crashed ("Unhandled exception during build") under a long TMPDIR, so
# it gets a short one of its own for the run.
unity_tmp="$(mktemp -d /tmp/check-unity-demo.XXXXXX)"
trap 'rm -rf "$stamp" "$unity_tmp"' EXIT
echo "check-unity-demo: $unity"
rm -f "$log"
# -ignorecompilercerrors so Unity reports every error rather than stopping at the
# first, and so its own exit code does not decide the outcome: the LOG does. A
# batch-mode Unity exits 0 with a project full of compiler errors, which is the
# trap this script exists to avoid falling into.
set +e
TMPDIR="$unity_tmp" "$unity" -batchmode -quit -nographics -projectPath "$project" -logFile "$log" -ignorecompilererrors >/dev/null 2>&1
set -e

if [ ! -f "$log" ]; then
  echo "check-unity-demo: Unity wrote no log; something stopped it before it started." >&2
  exit 1
fi

errors="$(grep -c "error CS" "$log" || true)"
if [ "$errors" -gt 0 ]; then
  echo "check-unity-demo: $errors compiler error(s) in the Unity demo:" >&2
  grep "error CS" "$log" | sort -u | sed 's/^/  /' >&2
  exit 1
fi

# A crash or an abandoned build can leave a log with no compiler error in it at all.
if grep -q "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log"; then
  echo "check-unity-demo: Unity did not finish the build:" >&2
  grep "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log" | sort -u | sed 's/^/  /' >&2
  echo "  See: $log" >&2
  exit 1
fi

missing=()
for dll in "${expected[@]}"; do
  [ "$assemblies/$dll" -nt "$stamp" ] || missing+=("$dll")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check-unity-demo: Unity did not compile ${missing[*]}, so nothing proves the scripts build." >&2
  echo "  (A licence prompt, a locked project library, or a crashed build step will do this.)  See: $log" >&2
  exit 1
fi

echo "check-unity-demo: the demo scripts compile."
