// ---------------------------------------------------------------------------
// Launching from a shell: `storyletter <path>` and `--at <where>` (Patterpad's
// shape). The argv readers are pure so they can be pinned by tests; the
// resolver turns a query into the same navigation the Find window sends, so
// the editor never needs a second way to open an item.
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { findProjectDir, runResolve, PACK_EXTENSION } from "@storylet-studio/ops";
import type { LoadedProject } from "@storylet-studio/ops";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { ReviewAt } from "../shared/api.js";

/** What a shell may hand us as a path: a project folder (any name, as long as
 *  a project shard is at or above it), one of its shards, or a pack. A bundle
 *  is the one associated file that is not a way in. */
const LAUNCH_FILE_EXTENSIONS = [...Object.values(SHARD_EXTENSIONS), PACK_EXTENSION];

/**
 * The project path on the command line, if any. In dev Electron is run as
 * `electron . …`, so the app path sits at argv[1] and is skipped; packaged, the
 * executable is argv[0] and everything after it is ours. A token that follows
 * `--at` is a location, never a path, and anything starting with `-` is a switch
 * (Electron's and Chromium's included).
 */
export function launchPathFromArgv(argv: string[], packaged: boolean): string | undefined {
  const args = argv.slice(packaged ? 1 : 2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === "--at") { i++; continue; }
    if (a.startsWith("-")) continue;
    if (isLaunchPath(a)) return a;
  }
  return undefined;
}

/** `storyletter <project> --at <where>` (or `--at=<where>`): open straight at an
 *  item instead of where the author last left off. With no path it reopens the
 *  last project at that item. */
export function launchLocationFromArgv(argv: string[], packaged: boolean): string | undefined {
  const args = argv.slice(packaged ? 1 : 2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === "--at") return args[i + 1]?.trim() || undefined;
    const inline = /^--at=(.*)$/.exec(a);
    if (inline) return inline[1]?.trim() || undefined;
  }
  return undefined;
}

function isLaunchPath(token: string): boolean {
  if (!existsSync(token)) return false;
  if (statSync(token).isDirectory()) return findProjectDir(token) !== undefined;
  const lower = token.toLowerCase();
  return LAUNCH_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True when `path` names the project already open at `root`, so a second
 *  launch jumps in place rather than reloading (which would drop the editor
 *  back to its landing page, and race the jump). A pack is never "the same
 *  project": it is a delivery that has to be unpacked somewhere. */
export function sameProject(path: string, root: string | undefined): boolean {
  if (root === undefined) return false;
  if (path.toLowerCase().endsWith(PACK_EXTENSION)) return false;
  const dir = findProjectDir(path);
  return dir !== undefined && resolve(dir) === resolve(root);
}

/**
 * The item a `--at` query names, as somewhere the editor can go: the same
 * shape the Find window sends (`SearchSelection`), widened to the box and the
 * outcome the way the review walk already widens it. The first hit wins, so an
 * ambiguous partial match lands on the earliest item in project order; the
 * resolve op's tiers guarantee an exact gameId or id is never outranked by a
 * fuzzy one. Undefined when nothing matches.
 */
export function launchLocation(loaded: LoadedProject, query: string): ReviewAt | undefined {
  const hit = runResolve(loaded, query)[0];
  if (!hit) return undefined;
  switch (hit.kind) {
    case "box": return { kind: "box", box: hit.box };
    case "deck": return { kind: "deck", box: hit.box, deck: hit.deck! };
    case "card": return { kind: "card", box: hit.box, deck: hit.deck!, card: hit.card! };
    case "outcome": return { kind: "outcome", box: hit.box, deck: hit.deck!, card: hit.card!, outcome: hit.id };
    case "template": return { kind: "template", box: hit.box, template: hit.id };
    case "hand": return { kind: "hand", box: hit.box, hand: hit.id };
    case "tagGroup": return { kind: "tagGroup", box: hit.box, group: hit.id };
  }
}
