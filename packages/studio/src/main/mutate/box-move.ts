// ---------------------------------------------------------------------------
// A box's folder follows its address (storylets#42, 2026-10-29).
//
// The format says folder names follow the names inside them and the editor
// keeps the two in step. Decks always did (renameDeck); a box kept the folder
// it was made with, on the belief that a renamed box keeps its address. It
// does not: until a manual Publish Bundle pins it, a box's gameId follows its
// title, so a retitled box sat in a folder named after an address it no longer
// had. Now a box edit that changes the address moves every shard in the folder,
// in the same undo step as the edit.
//
// The folder stays put, and the edit still lands, when moving it would be
// unsafe: the new name is not a legal address, the target already holds
// files, the folder holds anything that is not a shard (a legacy box's own
// assets/ pictures, which a text write cannot carry), or only the letter case
// differs (a case-insensitive disk would delete the file just written). None of
// those is worth refusing the author's rename over; the new-box check already
// treats a folder that differs from its address as taken.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, rmdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkProjectFiles } from "@storylet-studio/compiler";
import { boxFolderName } from "@storylet-studio/ops";
import { SOURCE_EXTENSIONS, isValidGameId } from "@storylet-studio/model";
import type { SourceBox } from "@storylet-studio/compiler";
import type { FileState } from "../history.js";

/** Every file under `dir` but the hidden ones, or none when it is not there. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full); else found.push(full);
    }
  };
  try { walk(dir); } catch { /* not there */ }
  return found;
}

/**
 * The box edit's writes, carried to the folder its address now names: each
 * shard written at its new path (the edit's own content where the edit wrote
 * it, the file's bytes otherwise) and deleted at its old one. The writes
 * unchanged, with no `from`, when the folder stays put.
 */
export function followBoxFolder(projectDir: string, box: SourceBox, writes: FileState[]): { writes: FileState[]; from?: string } {
  const from = box.path, to = boxFolderName(box.box);
  if (to === from || to.toLowerCase() === from.toLowerCase() || !isValidGameId(to)) return { writes };
  const oldDir = join(projectDir, from), newDir = join(projectDir, to);
  if (filesUnder(newDir).length > 0) return { writes };
  const shards = walkProjectFiles(oldDir, SOURCE_EXTENSIONS);
  if (shards.length === 0 || filesUnder(oldDir).length !== shards.length) return { writes };
  const inside = (path: string): boolean => path.startsWith(oldDir + sep);
  const given = new Map(writes.filter((w) => inside(w.path)).map((w) => [w.path, w.content]));
  const moved = shards.flatMap((path): FileState[] => [
    { path: join(newDir, relative(oldDir, path)), content: given.has(path) ? given.get(path)! : readFileSync(path, "utf8") },
    { path, content: null },
  ]);
  return { writes: [...moved, ...writes.filter((w) => !inside(w.path))], from: oldDir };
}

/** The folders a move emptied, deepest first. One still holding anything
 *  (a hidden file, something written meanwhile) is left alone. */
export function pruneEmptyFolders(dir: string): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) pruneEmptyFolders(join(dir, name));
  try { rmdirSync(dir); } catch { /* not empty, or not a folder: leave it */ }
}
