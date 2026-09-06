// ---------------------------------------------------------------------------
// The box map: reading and writing a box's `.storyletmap` shard.
//
// Where a box's HANDS stand in space, and the furniture drawn round them. Split
// out of the view shard on 2026-09-06 (design/engine-server.md 9.1 point 5):
// a hand's position ships in the bundle's `maps` block (4.3), which makes it the
// thing a venue provisions its kiosks against, so the map is the DESIGNER's
// shape, while the deck canvases next door stay the author's. One file could not
// be both, and the server's two keys are what made that matter.
//
// Sparse and forgiving, exactly as view.ts is, and for the same reason: the map
// answers to content that moves underneath it. A hand with no site has not been
// placed; a site for a hand that no longer exists is inert and is left alone.
//
// THE COMPATIBILITY WINDOW. Every project written before the split keeps its map
// in `view.storyletview` under `map`. It is READ from there (`boxMapOf`, in the
// compiler, is the one reader that knows both addresses) and never written back:
// each planner here writes the map shard and, in the same breath, plans the view
// shard without its `map`, so a project migrates itself the first time anybody
// touches its map. `runFormat` does the whole project at once, which is what the
// compiler's warning tells an author to run.
//
// Writes are planned, never performed: ops hands back PlannedWrites and the
// caller commits them through the VC layer, as everywhere else.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { boxMapOf, canonicalStringify } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { MAP_SCHEMA, SHARD_EXTENSIONS, VIEW_SCHEMA } from "@storylet-studio/model";
import type { BoxMap, MapShard, ViewPoint, ViewShard } from "@storylet-studio/model";
import type { PlannedWrite } from "./write.js";

/** Where the box keeps its map. */
export function mapPath(dir: string, box: SourceBox): string {
  return join(dir, box.path, `map${SHARD_EXTENSIONS.map}`);
}

/** Where the box keeps its canvases. Duplicated from view.ts rather than
 *  imported, to keep the two modules from depending on each other in a circle;
 *  both are one `join` over the same constant. */
const viewShardPath = (dir: string, box: SourceBox): string =>
  join(dir, box.path, `view${SHARD_EXTENSIONS.view}`);

/** The box's map as recorded, wherever it is recorded, or an empty one. */
export function boxMap(box: SourceBox): BoxMap {
  return boxMapOf(box) ?? {};
}

/**
 * Where the box's hands sit on its map, keyed by hand id: a POSITION each, and
 * nothing else. Sparse in the same way a deck's card positions are, so a hand
 * with no site has not been placed yet.
 *
 * Which zone a site is in is not kept here and is not read from here. A hand that
 * binds a zone says so in its own shard (`chosen`, or a rule binding), which is
 * what the runtime deals from; anything written here could only go on to
 * disagree with it. This projects x and y and nothing else, so a key some other
 * version of the app put beside them is simply not read here - which is a
 * narrowing read rather than compatibility code, and stays.
 */
export function mapSites(box: SourceBox): Record<string, ViewPoint> {
  const stored = boxMap(box).sites ?? {};
  const sites: Record<string, ViewPoint> = {};
  for (const [id, at] of Object.entries(stored)) sites[id] = { x: at.x, y: at.y };
  return sites;
}

/** One hand's new home on the map. */
export interface SitePlacement extends ViewPoint {
  id: string;
}

/** Positions are whole numbers, as they are on the node canvas: a coordinate
 *  that differs in its eleventh decimal place is a diff in the file and a merge
 *  conflict for nobody's benefit. */
const whole = (n: number): number => Math.round(n);

/** The map shard as it should be written, with an empty block dropped rather
 *  than stored: `{ map: {} }` is a husk, and "no map" is already the language
 *  for a box nobody has arranged. */
function mapWrite(dir: string, box: SourceBox, map: BoxMap): PlannedWrite[] {
  if (Object.keys(map).length === 0) {
    // Nothing left to record. A shard that exists is emptied to its schema (the
    // same husk `planForgetCanvas` leaves next door); one that never existed is
    // not created to say nothing.
    if (box.map === undefined) return [];
    const empty: MapShard = { schema: MAP_SCHEMA, map: {} };
    return [{ path: mapPath(dir, box), content: canonicalStringify(empty) }];
  }
  const shard: MapShard = { schema: MAP_SCHEMA, map };
  return [{ path: mapPath(dir, box), content: canonicalStringify(shard) }];
}

/**
 * The view shard as it should be written once its map has moved out: the same
 * shard minus `map`.
 *
 * Returns nothing when there is nothing to move, which is every project written
 * after the split. Never called on its own: the map has to land in its new file
 * in the same commit, or the positions are lost between the two writes.
 */
function viewDrop(dir: string, box: SourceBox): PlannedWrite[] {
  if (box.view?.map === undefined) return [];
  const shard: ViewShard = { ...box.view, schema: VIEW_SCHEMA };
  delete shard.map;
  return [{ path: viewShardPath(dir, box), content: canonicalStringify(shard) }];
}

/** The migration on its own: the map moved into its own shard, the view shard
 *  left without it. Empty for a box that has nothing to move. What `runFormat`
 *  applies across a whole project, and the reason the compiler's warning can
 *  name a command. */
export function planMapMigration(dir: string, box: SourceBox): PlannedWrite[] {
  const map = box.view?.map;
  if (map === undefined) return [];
  // A box with both: the map shard already wins everywhere that reads, so the
  // migration is only the removal of the copy nobody reads.
  if (box.map !== undefined) return viewDrop(dir, box);
  return [...mapWrite(dir, box, map), ...viewDrop(dir, box)];
}

/**
 * Plan the writes that record where a box's hands now sit on its map.
 *
 * Merged into whatever the map already holds, whole numbers, and empty when
 * nothing would change so an idle drag never touches a file. A second write
 * comes back when the map still lives in the view shard: the move out is part of
 * the same commit, never a separate one.
 */
export function planMapSites(
  dir: string, box: SourceBox, placements: SitePlacement[],
): PlannedWrite[] {
  const sites: Record<string, ViewPoint> = { ...mapSites(box) };
  let changed = false;
  for (const placement of placements) {
    const current = sites[placement.id];
    const next = { x: whole(placement.x), y: whole(placement.y) };
    if (current && current.x === next.x && current.y === next.y) continue;
    sites[placement.id] = next;
    changed = true;
  }
  if (!changed) return [];
  return [...mapWrite(dir, box, { ...boxMap(box), sites }), ...viewDrop(dir, box)];
}

/**
 * Plan the writes that take hands OFF the map.
 *
 * The site is removed rather than emptied, exactly as a forgotten canvas is: the
 * file should not accumulate husks of hands nobody has placed, and "no entry" is
 * already the language for "not placed" everywhere else here. The hand itself is
 * untouched; only its position on a map is.
 */
export function planForgetSites(dir: string, box: SourceBox, handIds: string[]): PlannedWrite[] {
  const sites = { ...mapSites(box) };
  let changed = false;
  for (const id of handIds) {
    if (sites[id] === undefined) continue;
    delete sites[id];
    changed = true;
  }
  if (!changed) return [];

  // An empty sites record is a husk too: rebuilt from what is left rather than
  // emptied in place.
  const map: BoxMap = { ...boxMap(box) };
  if (Object.keys(sites).length > 0) map.sites = sites; else delete map.sites;
  return [...mapWrite(dir, box, map), ...viewDrop(dir, box)];
}

/** Plan the writes that record the map's own furniture. The whole list, for the
 *  reason `planCanvasFurniture` gives; this is the map half of it. */
export function planMapFurniture(
  dir: string, box: SourceBox, frames: NonNullable<BoxMap["frames"]>,
): PlannedWrite[] {
  const map: BoxMap = { ...boxMap(box) };
  if (frames.length > 0) map.frames = frames; else delete map.frames;
  return [...mapWrite(dir, box, map), ...viewDrop(dir, box)];
}
