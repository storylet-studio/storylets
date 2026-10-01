// ---------------------------------------------------------------------------
// The maps on disk: the PROJECT map (the root `map.storyletmap`: the zone group
// and the map's frames, design/project-map-contract.md 1.1) and each box's own
// `.storyletmap` (its SITES, 1.3).
//
// Where a box's HANDS stand in space. Split out of the view shard on 2026-09-06
// (design/engine-server.md 9.1 point 5): a hand's position ships in the bundle's
// `map.geometry.sites` (4.3), which makes it the thing a venue provisions its
// kiosks against, so the map is the DESIGNER's shape, while the deck canvases
// next door stay the author's. One file could not be both, and the server's two
// keys are what made that matter. The furniture drawn round the sites is the
// project map's since the project map: there is one map, so one set of frames.
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
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import { MAP_SCHEMA, PROJECTMAP_SCHEMA, SHARD_EXTENSIONS, VIEW_SCHEMA } from "@storylet-studio/model";
import type { BoxMap, Frame, MapShard, ProjectMapShard, TagGroup, ViewPoint, ViewShard } from "@storylet-studio/model";
import type { PlannedWrite } from "./write.js";

// --- the project map -------------------------------------------------------------

/** Where the project keeps its map: the root, beside the project shard. */
export function projectMapPath(dir: string): string {
  return join(dir, `map${SHARD_EXTENSIONS.map}`);
}

/** The project map's zone group, or undefined when the project has no map. */
export function projectMapGroup(source: SourceProject): TagGroup | undefined {
  return source.map?.group;
}

/** The boxes on the project map, in project order. */
export function boxesOnMap(source: SourceProject): SourceBox[] {
  return source.boxes.filter((box) => box.box.box.usesMap === true);
}

/**
 * Plan the write that records the project map with `group` as its zone group,
 * keeping the frames it already has. The shard is created when the project had
 * none: the one act that makes a project have a map.
 */
export function planProjectMapGroup(dir: string, source: SourceProject, group: TagGroup): PlannedWrite {
  const shard: ProjectMapShard = { ...source.map, schema: PROJECTMAP_SCHEMA, group };
  return { path: projectMapPath(dir), content: canonicalStringify(shard) };
}

/** Plan the write that records the project map's frames, the whole list (the
 *  reason `planCanvasFurniture` gives). Nothing to plan for a project with no
 *  map: there is nothing to draw them on. */
export function planProjectMapFrames(dir: string, source: SourceProject, frames: Frame[]): PlannedWrite[] {
  if (source.map === undefined) return [];
  const shard: ProjectMapShard = { ...source.map, schema: PROJECTMAP_SCHEMA };
  if (frames.length > 0) shard.frames = frames; else delete shard.frames;
  return [{ path: projectMapPath(dir), content: canonicalStringify(shard) }];
}

// --- a box's sites ---------------------------------------------------------------

/** Where the box keeps its map. */
export function mapPath(dir: string, box: SourceBox): string {
  return join(dir, box.path, `map${SHARD_EXTENSIONS.map}`);
}

/** Where the box keeps its canvases. Duplicated from view.ts rather than
 *  imported, to keep the two modules from depending on each other in a circle;
 *  both are one `join` over the same constant. */
const viewShardPath = (dir: string, box: SourceBox): string =>
  join(dir, box.path, `view${SHARD_EXTENSIONS.view}`);

/** The box's map as recorded, wherever it is recorded, or an empty one. Its
 *  sites, that is: frames a shard from before the project map still carries are
 *  read by nothing but the formatter, and are kept as they are by every write
 *  here until it moves them. */
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

