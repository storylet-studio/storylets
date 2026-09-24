#!/usr/bin/env bash
# The combined Patter + Storylet Engine proof in a REAL Unity: both real packages
# in one project, one kernel, one registry through both engines, one save.
#
# The dotnet host (ports/unity/TestHost/with-patter) compiles SOURCES, so it
# cannot see what only Unity decides: that the two packages' asmdefs resolve to
# one kernel assembly (Patterplay.Expr) because the Storylet Engine's own
# (StoryletEngine.Expr) switches itself off when Patterplay 0.14.0 or newer is
# installed, and that both runtimes, their Json layers and their Editor
# assemblies then compile against it. This script assembles a throwaway project
# OUTSIDE the repo and asks Unity:
#
#   Packages/manifest.json   the Storylet Engine from this repo, by file path;
#                            Patterplay from a COPY of ../patter's package
#   Assets/Probe/            CombinedGame.cs (the dotnet host's cases, unchanged)
#                            and WithPatterProbe.cs, from ports/unity/TestHost/with-patter
#   Assets/Editor/           WithPatterEditor.cs (the -executeMethod entry points)
#
# Patterplay is staged with its package.json version set to 0.14.0. That is the
# release that will carry the shared kernel: the Storylet Engine defers to a
# Patterplay at or above it, and 0.13.0 (the released one) has no kernel, so the
# Storylet Engine's skew assembly would stop the build with an #error naming the
# fix. Until Patterplay 0.14.0 is released, any real-Unity combined check has to
# stage Patter's source at that version (patterkit design/shared-kernel-plan.md).
# The copy is what gets the edit; ../patter is never touched.
#
# It passes only on positive evidence, never on Unity's exit code (a batch-mode
# Unity exits 0 with a project full of compiler errors, and a crashed build step
# has been read as a success before):
#   - no compiler error, no crash marker in the log;
#   - every expected assembly compiled fresh, Patterplay.Expr.dll among them;
#   - NO StoryletEngine.Expr.dll and no StoryletEngine.ExprSkew.dll;
#   - the probe's result file, written by this run, reporting the kernel as
#     Patterplay.Expr and ending WITH PATTER ALL PASS.
# Then, unless PLAYER=0, the same probe as a macOS IL2CPP player: built, run,
# and read the same way.
#
# Usage:  ./scripts/check-unity-with-patter.sh
#         UNITY_PATH=/path/to/Unity PATTER_DIR=/path/to/patter ./scripts/check-unity-with-patter.sh
#
# Environment:
#   UNITY_PATH      the Unity binary (default: the newest Hub editor)
#   PATTER_DIR      the Patter checkout (default: ../patter beside this repo)
#   REQUIRE_PATTER  set to 1 to make a missing Patter checkout a FAILURE, not a skip
#   PLAYER          set to 0 to skip the IL2CPP player (it adds several minutes)
#   KEEP            set to 1 to keep the scratch project and print its path
#
# Without a Patter checkout it prints SKIP and exits 0, so a plain clone of this
# repo runs everything else.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
storylets_pkg="$root/ports/unity/StoryletEngine"
probe_src="$root/ports/unity/TestHost/with-patter"
patter_dir="${PATTER_DIR:-$root/../patter}"
patter_pkg="$patter_dir/ports/unity/Patterplay"
staged_version="0.14.0"

if [ ! -f "$patter_pkg/package.json" ]; then
  msg="no Patterplay source at $patter_pkg (clone wildwinter/patter beside storylets, or set PATTER_DIR)"
  if [ "${REQUIRE_PATTER:-}" = "1" ]; then
    echo "FAIL check-unity-with-patter: $msg"
    exit 1
  fi
  echo "SKIP check-unity-with-patter: $msg"
  exit 0
fi

unity="${UNITY_PATH:-}"
if [ -z "$unity" ]; then
  # Newest Hub editor. `sort -V` so 6000.4.10 beats 6000.4.6 rather than losing
  # to it alphabetically.
  unity="$(ls -d /Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ ! -x "$unity" ]; then
  echo "check-unity-with-patter: no Unity editor found." >&2
  echo "  Install one through Unity Hub, or point at it: UNITY_PATH=/path/to/Unity $0" >&2
  exit 2
fi

# The scratch project, and a short TMPDIR of Unity's own: its build step crashed
# ("Unhandled exception during build") under a long TMPDIR. Both under /tmp and
# both short, so no path in the run is long.
scratch="$(mktemp -d /tmp/sl-with-patter.XXXXXX)"
unity_tmp="$(mktemp -d /tmp/sl-wp-tmp.XXXXXX)"
if [ "${KEEP:-}" = "1" ]; then
  echo "check-unity-with-patter: keeping the scratch project at $scratch"
  trap 'rm -rf "$unity_tmp"' EXIT
else
  trap 'rm -rf "$scratch" "$unity_tmp"' EXIT
fi
proj="$scratch/proj"
log="$scratch/editor.log"

# --- Patterplay, staged at the version that carries the kernel -----------------------
cp -R "$patter_pkg" "$scratch/Patterplay"
from_version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$scratch/Patterplay/package.json" | head -1)"
# The first "version" key only: package.json's own, not a dependency's.
perl -0pi -e 's/"version":\s*"[^"]*"/"version": "'"$staged_version"'"/' "$scratch/Patterplay/package.json"
if ! grep -q "\"version\": \"$staged_version\"" "$scratch/Patterplay/package.json"; then
  echo "check-unity-with-patter: could not stage Patterplay at $staged_version." >&2
  exit 1
fi
echo "check-unity-with-patter: Patterplay from $(cd "$patter_dir" && pwd)" \
  "($(git -C "$patter_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" \
  "$(git -C "$patter_dir" rev-parse --short HEAD 2>/dev/null || echo '?'))," \
  "version $from_version staged as $staged_version"

# --- the project ---------------------------------------------------------------------
mkdir -p "$proj/Assets/Probe" "$proj/Assets/Editor" "$proj/Packages"
cp "$probe_src/CombinedGame.cs" "$probe_src/unity/WithPatterProbe.cs" "$proj/Assets/Probe/"
cp "$probe_src/unity/Editor/WithPatterEditor.cs" "$proj/Assets/Editor/"
cat > "$proj/Packages/manifest.json" <<EOF
{
  "dependencies": {
    "com.storylet-studio.storyletengine": "file:$storylets_pkg",
    "com.patterkit.patterplay": "file:$scratch/Patterplay",
    "com.unity.nuget.newtonsoft-json": "3.2.1",
    "com.unity.modules.imgui": "1.0.0",
    "com.unity.modules.jsonserialize": "1.0.0",
    "com.unity.modules.ui": "1.0.0",
    "com.unity.modules.uielements": "1.0.0"
  }
}
EOF

# Positive evidence of a compile, not a grep for a name (see check-unity-demo.sh
# for the crash that taught this): clear the compiled assemblies, then require
# every expected one to exist and be newer than the start of the run. The
# project is new, so there are none yet; the clear is kept so that KEEP=1 plus a
# rerun by hand cannot read an old compile.
assemblies="$proj/Library/ScriptAssemblies"
expected=(
  Patterplay.Expr.dll Patterplay.Runtime.dll Patterplay.Runtime.Json.dll Patterplay.Runtime.Unity.dll Patterplay.Editor.dll
  StoryletEngine.Runtime.dll StoryletEngine.Runtime.Json.dll StoryletEngine.Runtime.Unity.dll StoryletEngine.Editor.dll
  Assembly-CSharp.dll Assembly-CSharp-Editor.dll
)
# The Storylet Engine's kernel must switch itself off, and its skew error must not fire.
forbidden=(StoryletEngine.Expr.dll StoryletEngine.ExprSkew.dll)
rm -rf "$assemblies"
stamp="$scratch/stamp"
touch "$stamp"
sleep 1

# Unity's verdict on its log. Prints the reason and returns 1 on any failure.
read_log() {
  local what="$1" file="$2"
  if [ ! -f "$file" ]; then
    echo "check-unity-with-patter: $what: Unity wrote no log; something stopped it before it started." >&2
    return 1
  fi
  local errors
  errors="$(grep -c "error CS" "$file" || true)"
  if [ "$errors" -gt 0 ]; then
    # An #error first: the Storylet Engine's skew assembly names the fix in one.
    echo "check-unity-with-patter: $what: $errors compiler error(s), the first 30 of them:" >&2
    { grep "error CS1029" "$file" | sort -u; grep "error CS" "$file" | grep -v "error CS1029" | sort -u; } | head -30 | sed 's/^/  /' >&2
    echo "  See: $file" >&2
    return 1
  fi
  # A crash or an abandoned build can leave a log with no compiler error in it at all.
  local crash="Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors\|executeMethod class .* could not be found\|executeMethod method .* could not be found"
  if grep -q "$crash" "$file"; then
    echo "check-unity-with-patter: $what: Unity did not finish:" >&2
    grep "$crash" "$file" | sort -u | sed 's/^/  /' >&2
    echo "  See: $file" >&2
    return 1
  fi
}

# The probe's verdict on its own result file, written by this run.
read_result() {
  local what="$1" file="$2"
  if [ ! -f "$file" ] || [ ! "$file" -nt "$stamp" ]; then
    echo "check-unity-with-patter: $what: the probe wrote no result, so nothing proves it ran." >&2
    return 1
  fi
  sed 's/^/  /' "$file"
  if ! grep -qx "kernel Patterplay.Expr" "$file"; then
    echo "check-unity-with-patter: $what: the probe did not report Patterplay.Expr as the kernel." >&2
    return 1
  fi
  if [ "$(tail -1 "$file")" != "WITH PATTER ALL PASS" ]; then
    echo "check-unity-with-patter: $what: the probe's verdict is '$(tail -1 "$file")'." >&2
    return 1
  fi
}

# --- the editor: compile both packages, then run the probe ------------------------------
echo "check-unity-with-patter: $unity"
echo "check-unity-with-patter: compiling both packages and running the probe in the editor..."
# -ignorecompilererrors so Unity reports every error rather than stopping at the
# first; the log, the assemblies and the result file decide, not the exit code.
set +e
PROBE_OUT="$scratch/editor-result.txt" TMPDIR="$unity_tmp" "$unity" -batchmode -nographics \
  -projectPath "$proj" -logFile "$log" -ignorecompilererrors \
  -executeMethod StoryletStudio.CombinedProof.WithPatterEditor.Probe >/dev/null 2>&1
set -e
read_log "the editor" "$log" || exit 1

missing=()
for dll in "${expected[@]}"; do
  [ "$assemblies/$dll" -nt "$stamp" ] || missing+=("$dll")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check-unity-with-patter: Unity did not compile ${missing[*]}, so nothing proves the packages build together." >&2
  echo "  (A licence prompt, a locked project library, or a crashed build step will do this.)  See: $log" >&2
  exit 1
fi
present=()
for dll in "${forbidden[@]}"; do
  [ ! -e "$assemblies/$dll" ] || present+=("$dll")
done
if [ "${#present[@]}" -gt 0 ]; then
  echo "check-unity-with-patter: Unity compiled ${present[*]}: the Storylet Engine did not defer to Patterplay's kernel." >&2
  exit 1
fi
echo "check-unity-with-patter: compiled ${#expected[@]} assemblies fresh, Patterplay.Expr.dll among them; no ${forbidden[*]}."
read_result "the editor" "$scratch/editor-result.txt" || exit 1

if [ "${PLAYER:-1}" = "0" ]; then
  echo "check-unity-with-patter: PLAYER=0, so no IL2CPP player this run."
  echo "check-unity-with-patter: one registry, one save, both engines, one kernel (Patterplay's), in the editor."
  exit 0
fi

# --- the player: the same probe, built with IL2CPP for macOS, and run -------------------
player_log="$scratch/player-build.log"
app="$scratch/player/WithPatter.app"
echo "check-unity-with-patter: building the probe as a macOS IL2CPP player..."
set +e
PLAYER_OUT="$app" TMPDIR="$unity_tmp" "$unity" -batchmode -nographics \
  -projectPath "$proj" -logFile "$player_log" \
  -executeMethod StoryletStudio.CombinedProof.WithPatterEditor.BuildPlayer >/dev/null 2>&1
set -e
read_log "the player build" "$player_log" || exit 1
if ! grep -q "\[with-patter\] BUILD RESULT: Succeeded" "$player_log"; then
  echo "check-unity-with-patter: the IL2CPP player build did not succeed:" >&2
  grep "\[with-patter\] BUILD RESULT\|Error building Player\|error:" "$player_log" | sort -u | head -20 | sed 's/^/  /' >&2
  echo "  See: $player_log" >&2
  exit 1
fi
exe="$(ls "$app/Contents/MacOS/"* 2>/dev/null | head -1 || true)"
if [ ! -x "$exe" ] || [ ! -f "$app/Contents/Frameworks/GameAssembly.dylib" ]; then
  echo "check-unity-with-patter: no IL2CPP player at $app (no executable, or no GameAssembly.dylib)." >&2
  exit 1
fi
# The player's own list of the assemblies it was built from: the one kernel, and not the other.
scripting="$app/Contents/Resources/Data/ScriptingAssemblies.json"
if ! grep -q '"Patterplay.Expr.dll"' "$scripting" 2>/dev/null || grep -q '"StoryletEngine.Expr.dll"\|"StoryletEngine.ExprSkew.dll"' "$scripting"; then
  echo "check-unity-with-patter: the player's ScriptingAssemblies.json does not list Patterplay.Expr.dll alone as the kernel:" >&2
  grep -o '"[A-Za-z.]*Expr[A-Za-z.]*\.dll"' "$scripting" 2>/dev/null | sed 's/^/  /' >&2 || true
  exit 1
fi
echo "check-unity-with-patter: running the player..."
set +e
PROBE_OUT="$scratch/player-result.txt" TMPDIR="$unity_tmp" "$exe" -batchmode -nographics \
  -logFile "$scratch/player-run.log" >/dev/null 2>&1
set -e
read_result "the IL2CPP player" "$scratch/player-result.txt" || { echo "  See: $scratch/player-run.log" >&2; exit 1; }

echo "check-unity-with-patter: one registry, one save, both engines, one kernel (Patterplay's), in the editor and in a macOS IL2CPP player."
