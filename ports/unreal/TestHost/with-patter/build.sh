#!/usr/bin/env bash
# The combined proof on Unreal's C++ (clang, no Unreal): Patterplay and the Storylet Engine in one
# translation unit, on one ScopeRegistry. See main.cpp beside this.
#
# Patterplay's C++ core comes from a sibling ../patter checkout (or PATTER_ROOT), as the JS
# combined test reads Patter's source from it. Without one this SKIPS, saying so, and exits 0:
# someone working in this repo alone is not blocked by a repo they do not have. REQUIRE_PATTER=1
# (CI) turns that skip into a failure.
#
# Three steps, each of which fails the script:
#   1. the combined game: every case of packages/runtime/test/with-patter/combined-game.test.ts;
#   2. the tripwire: a translation unit that includes the two plugins' kernels with DIFFERENT
#      kernel ids must stop at the kernel's #error, and at nothing else, in either order, while
#      the same TU with the same ids compiles;
#   3. with --probes, each deliberate integration mistake (main.cpp's Probe) must fail at least
#      one case, and together they must fail every case.
#
#   bash ports/unreal/TestHost/with-patter/build.sh            # steps 1 and 2
#   bash ports/unreal/TestHost/with-patter/build.sh --probes   # and step 3
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
patter="${PATTER_ROOT:-$root/../patter}"
storylets_public="$root/ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public"
patter_public="$patter/ports/unreal/Patterplay/Source/PatterplayRuntime/Public"

if [ ! -f "$patter_public/Patter/Engine.h" ]; then
  # CI sets REQUIRE_PATTER, as for the Godot and dotnet combined proofs: there a skip would be
  # a green that proved nothing.
  if [ -n "${REQUIRE_PATTER:-}" ]; then
    echo "with-patter: FAIL, no Patterplay source at $patter_public, and REQUIRE_PATTER is set."
    exit 1
  fi
  echo "with-patter: SKIPPED, no Patterplay source at $patter_public."
  echo "  The combined proof compiles Patterplay's C++ core from a sibling ../patter checkout (or PATTER_ROOT)."
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/with-patter.XXXXXX")"
trap 'rm -rf "$work"' EXIT
host="$work/with_patter_testhost"

# --- 1. the combined game ----------------------------------------------------------------
clang++ -std=c++17 -O2 -Wall -Wextra \
  -I"$storylets_public" -I"$patter_public" \
  "$here/main.cpp" -o "$host"
"$host"

# --- 2. the tripwire ---------------------------------------------------------------------
# A copy of Patterplay's kernel restamped with another id, as an older or newer Patterplay would
# carry. The same TU with both real copies must compile (the control); with the restamped copy,
# in either order, it must stop at the kernel's #error naming the fix.
id="$(sed -n 's/.*inline namespace \(k[0-9a-f]\{8\}\).*/\1/p' "$patter_public/Patter/Expr/Value.h" | head -1)"
if [ -z "$id" ]; then echo "with-patter: FAIL, no kernel id found in Patterplay's Expr/Value.h"; exit 1; fi
other="k00000000"; [ "$id" = "$other" ] && other="k11111111"
mkdir -p "$work/other/Patter/Expr"
for f in "$patter_public/Patter/Expr/"*.h; do
  sed -e "s/$id/$other/g" -e "s/0x${id#k}/0x${other#k}/g" "$f" > "$work/other/Patter/Expr/$(basename "$f")"
done
printf '#include "Storylets/Expr/ScopeRegistry.h"\n#include "Patter/Expr/ScopeRegistry.h"\nint main() { return 0; }\n' > "$work/storylets-first.cpp"
printf '#include "Patter/Expr/ScopeRegistry.h"\n#include "Storylets/Expr/ScopeRegistry.h"\nint main() { return 0; }\n' > "$work/patter-first.cpp"
want="The Patterplay and Storylet Engine plugins must be built from the same kernel: update the older plugin."
for order in storylets-first patter-first; do
  if ! clang++ -std=c++17 -fsyntax-only -I"$storylets_public" -I"$patter_public" "$work/$order.cpp" 2> "$work/same.log"; then
    echo "with-patter: FAIL, the control ($order, one kernel id) did not compile:"; cat "$work/same.log"; exit 1
  fi
  if clang++ -std=c++17 -fsyntax-only -I"$storylets_public" -I"$work/other" "$work/$order.cpp" 2> "$work/skew.log"; then
    echo "with-patter: FAIL, two kernels ($id and $other, $order) compiled in one translation unit"; exit 1
  fi
  if ! grep -qF "$want" "$work/skew.log"; then
    echo "with-patter: FAIL, two kernels ($order) failed, but not at the tripwire:"; head -20 "$work/skew.log"; exit 1
  fi
  if [ "$(grep -c 'error:' "$work/skew.log")" != 1 ]; then
    echo "with-patter: FAIL, two kernels ($order) stopped at the tripwire, but not only there:"; grep 'error:' "$work/skew.log" | head -10; exit 1
  fi
  echo "tripwire ($order): two kernels in one translation unit stop at: $(grep -m1 -o 'error: .*' "$work/skew.log")"
done

# --- 3. the probes -------------------------------------------------------------------------
if [ "${1:-}" = "--probes" ]; then
  failed_cases="$work/failed-cases"
  : > "$failed_cases"
  for probe in two-registries no-registry-load engines-save-values fresh-swap no-clash; do
    if "$host" "$probe" > "$work/probe.log" 2>&1; then
      echo "with-patter: FAIL, probe $probe passed every case"; exit 1
    fi
    n="$(grep -c '^  FAIL ' "$work/probe.log" || true)"
    echo "probe $probe: $n case(s) fail"
    grep '^  FAIL ' "$work/probe.log" | sed 's/^  FAIL //' | tee -a "$failed_cases" | sed 's/^/    /'
  done
  all="$("$host" | grep -c '^  ok ' || true)"
  caught="$(sort -u "$failed_cases" | wc -l | tr -d ' ')"
  # Every case label appears twice (once per registry saver) plus the crossed one, so compare
  # distinct labels failed against distinct labels run.
  labels="$("$host" | grep '^  ok ' | sed 's/^  ok   //' | sort -u | wc -l | tr -d ' ')"
  if [ "$caught" != "$labels" ]; then
    echo "with-patter: FAIL, the probes failed $caught of $labels distinct cases:"
    comm -13 <(sort -u "$failed_cases") <("$host" | grep '^  ok ' | sed 's/^  ok   //' | sort -u) | sed 's/^/    never failed: /'
    exit 1
  fi
  echo "probes: every one of the $labels distinct cases ($all runs) fails under at least one probe"
fi
