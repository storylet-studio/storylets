#!/usr/bin/env bash
# The combined Patter + Storylet Engine proof on Godot (test_with_patter.gd).
#
# It needs both addons in ONE Godot project, and Patterplay from the SOURCE of a
# sibling ../patter checkout: the Patter this programme is building, not a
# release (so never the Hamlet demo's pinned copy). Neither repo's own project
# is touched. This assembles a throwaway project in a temporary directory:
#
#   project.godot                 written here, both addons' plugins enabled
#   addons/storyletengine/        copied from this repo's ports/godot/addons
#   addons/patterplay/            copied from $PATTER_DIR/ports/godot/addons
#   test/test_with_patter.gd      copied from beside this script
#
# COPIED, not symlinked: importing writes .uid and .import files beside the
# scripts, and through a symlink those would land in the two checkouts.
#
#   bash ports/godot/test/with-patter/run.sh
#
# Environment:
#   GODOT          the Godot 4.7 binary (default: the macOS app bundle's)
#   PATTER_DIR     the Patter checkout (default: ../patter beside this repo)
#   REQUIRE_PATTER set to 1 to make a missing Patter checkout a FAILURE rather
#                  than a skip (CI sets it: a skip there would be a green that
#                  proved nothing)
#   KEEP           set to 1 to keep the assembled project and print its path
#
# Without a Patter checkout it prints SKIP and exits 0, so a plain clone of this
# repo runs everything else. Otherwise it passes only on the suite's own verdict
# line, WITH PATTER ALL PASS: a GDScript file that fails to parse exits 0 and
# prints no verdict, so the exit code alone cannot be trusted.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
patter_dir="${PATTER_DIR:-$root/../patter}"
patter_addon="$patter_dir/ports/godot/addons/patterplay"

if [ ! -f "$patter_addon/plugin.cfg" ]; then
  msg="no Patterplay source at $patter_addon (clone wildwinter/patter beside storylets, or set PATTER_DIR)"
  if [ "${REQUIRE_PATTER:-}" = "1" ]; then
    echo "FAIL test_with_patter: $msg"
    exit 1
  fi
  echo "SKIP test_with_patter: $msg"
  exit 0
fi
if [ ! -x "$godot" ]; then
  echo "FAIL test_with_patter: no Godot at $godot (set GODOT=/path/to/godot)"
  exit 1
fi

proj="$(mktemp -d "${TMPDIR:-/tmp}/storylets-with-patter.XXXXXX")"
if [ "${KEEP:-}" = "1" ]; then
  echo "test_with_patter: keeping the assembled project at $proj"
else
  trap 'rm -rf "$proj"' EXIT
fi

mkdir -p "$proj/addons" "$proj/test"
cp -R "$root/ports/godot/addons/storyletengine" "$proj/addons/storyletengine"
cp -R "$patter_addon" "$proj/addons/patterplay"
cp "$here/test_with_patter.gd" "$proj/test/test_with_patter.gd"
cat > "$proj/project.godot" <<'EOF'
; Assembled by storylets/ports/godot/test/with-patter/run.sh; thrown away after the run.
config_version=5

[application]

config/name="Storylet Engine + Patterplay (combined proof)"
config/features=PackedStringArray("4.7")

[editor_plugins]

enabled=PackedStringArray("res://addons/patterplay/plugin.cfg", "res://addons/storyletengine/plugin.cfg")
EOF

echo "test_with_patter: Patterplay from $(cd "$patter_dir" && pwd)" \
  "($(git -C "$patter_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" \
  "$(git -C "$patter_dir" rev-parse --short HEAD 2>/dev/null || echo '?'))"

# Once, so both addons' class_names are registered before the suite runs. Its
# output is kept: a class_name two scripts claimed is reported here.
import_log="$proj/import.log"
"$godot" --headless --path "$proj" --import >"$import_log" 2>&1 || true
if grep -E 'hides a global script class|Parse Error|SCRIPT ERROR' "$import_log"; then
  echo "FAIL test_with_patter: importing the combined project reported the errors above"
  exit 1
fi

out="$proj/run.log"
set +e
"$godot" --headless --path "$proj" --script res://test/test_with_patter.gd 2>&1 | tee "$out"
code=${PIPESTATUS[0]}
set -e
if [ "$code" -ne 0 ] || ! grep -qx 'WITH PATTER ALL PASS' "$out"; then
  echo "FAIL test_with_patter: exit $code, and no 'WITH PATTER ALL PASS' verdict"
  exit 1
fi
