// ---------------------------------------------------------------------------
// The project map: hands' sites and the zones they stand in, the zones'
// outlines and stacking, the pictures behind them, a box's colour on it, and
// a box joining or leaving it (with the guard on leaving, map-leave.ts).
// ---------------------------------------------------------------------------

import { basename, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { canonicalStringify } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import {
  ASSETS_DIR, freeAssetName, imageSize, isSafeAssetName, mapPath, mapSites, newId, planForgetSites, planMapSites, projectMapPath,
} from "@storylet-studio/ops";
import {
  PROJECTMAP_SCHEMA, backgroundsOf, bindHand, droppedRect, effectiveGameId, framesOf, freeGameId, gameIdify, handBinding,
  isSpatial, isValidGameId, polygonOf, restack, unbindHand, withBackgrounds, withPolygon, withSpatialGroup, withZ, zOf, zoneAt,
} from "@storylet-studio/model";
import type { Polygon, ProjectMapShard, SpatialBackground, StackMove, Tag, TagGroup } from "@storylet-studio/model";
import { plural } from "@wildwinter/app-shell/util";
import type { FileState } from "../history.js";
import { boxWithMap } from "../project.js";
import type { ProjectSession } from "../project.js";
import { allFinite } from "../trust.js";
import { colourWrite, joiningColour } from "../box-colours.js";
import { boxMapDto, mapViewDto } from "../read/map.js";
import type { BoxMapDto, LeaveRefusalDto, OpenResult, ProjectMapViewDto } from "../../shared/api.js";
import { commit, commitMaking, ensureBoxColours, freshKey, refuse, reload } from "./write-path.js";
import type { Written } from "./write-path.js";
import {
  boxWrite, finitePoints, gone, groupHome, handsWrite, locateBox, mapGroupHome, refusedNumber, tagsWrite,
} from "./shards.js";
import { whyStillOnMap } from "./map-leave.js";

/** A pin's new home on the map. Where it is; which zone that turns out to be is
 *  worked out here, not asked for. */
export interface MapSiteMove { id: string; x: number; y: number }

/** A hand whose zone changed as a side effect: `zone` null means it now sits in
 *  none, which for a hand that needs one is an error the Problems bar will name. */
export interface SiteRebinding { id: string; zone: string | null }

/**
 * THE rule of the map: a hand whose PIN is dragged belongs to the zone it was
 * dropped in.
 *
 * ONE GESTURE, and only one (the ruling of 2026-09-07). Until then this ran
 * after either side of that sentence changed - the pin moved, or the zones did -
 * and the second half was wrong: nudging an outline sixty points quietly
 * stripped `chosen` off the hands it had left behind, one of them losing the
 * block whole, and left the project invalid with nothing said. Geometry is the
 * designer's drawing; a binding is content, and content changes where somebody
 * changes it. The canvas has said so since 2026-08-06 (`applyOutline` in
 * map-view.ts); this is the write path agreeing.
 *
 * A pin left sitting outside the zone it is bound to is visible, harmless, and
 * fixed by dragging it - which is the gesture that means it.
 *
 * A hand whose pin is DROPPED outside every zone is left LOOSE: its binding is
 * cleared rather than quietly kept. If that hand needs a zone the compiler says
 * so ("missing chosen tag ... a hand is fully concrete") and the author sees an
 * error, which is the honest outcome; keeping the old zone would leave the map
 * asserting something no longer true and nothing anywhere saying so.
 *
 * Only PINNED hands are governed. A hand nobody has placed has no position and
 * therefore no opinion, and must keep the binding it was given elsewhere.
 * Bindings that belong to a template are never touched (see `bindHand`).
 *
 * `positions` overrides what the map shard holds, for the one caller there is:
 * the site drag, in the middle of moving sites and yet to write them.
 */
export function bindSitesToZones(
  box: SourceBox, groupId: string, positions?: Record<string, { x: number; y: number }>,
): SiteRebinding[] {
  const group = box.tags.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const zones: { id: string; polygon: Polygon; z?: number }[] = [];
  for (const tag of group.tags) {
    const polygon = polygonOf(tag);
    const z = zOf(tag);
    if (polygon) zones.push({ id: tag.id, polygon, ...(z !== undefined ? { z } : {}) });
  }
  const sites = { ...mapSites(box), ...positions };

  const changed: SiteRebinding[] = [];
  for (const hand of box.hands.hands) {
    const at = sites[hand.id];
    if (!at) continue;
    const template = box.hands.templates.find((t) => t.id === hand.template);
    const binding = handBinding(hand, template, groupId);
    if (!binding.editable) continue;
    const zone = zoneAt(at, zones) ?? null;
    if (zone === (binding.tag ?? null)) continue;
    const moved = zone === null
      ? unbindHand(hand, template, groupId)
      : bindHand(hand, template, groupId, zone);
    if (moved) changed.push({ id: hand.id, zone });
  }
  return changed;
}

// --- what the map pages draw -------------------------------------------------------
//
// Reads (read/map.ts), with one write in front of them: a box drawn on the map
// for the first time gets its colour stored here (`ensureBoxColours`), which is
// why their handlers run in the write queue.

/** The project map, with every box on it as a layer. */
export async function projectMapView(session: ProjectSession | undefined): Promise<ProjectMapViewDto> {
  if (session?.loaded.source?.map !== undefined) await ensureBoxColours(session);
  return mapViewDto(session);
}

/** The map one box shows (the Board's, and a box's own view): its colour stored
 *  first, as the editor's map stores it, so the Board draws pins in it. */
export async function boxMap(session: ProjectSession | undefined, boxId: string, groupId?: string): Promise<BoxMapDto> {
  if (session?.loaded.source?.boxes.some((b) => b.box.box.id === boxId)) await ensureBoxColours(session);
  return boxMapDto(session, boxId, groupId);
}

/** The author picked a colour for a box's layer: stored, and undoable. */
export async function setBoxColour(session: ProjectSession, boxId: string, colour: number): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  if (!Number.isInteger(colour) || colour < 0 || colour > 11) return { error: `not a palette colour (${colour})` };
  const write = colourWrite(session, box, colour);
  if (write === undefined) return reload(session);
  return commit(session, "Change the layer's colour", freshKey(), [write]);
}

// --- joining and leaving -------------------------------------------------------------

/**
 * Put a box on the project map, or take it off (the surfacing review's plan
 * item 2: the opt-in is one quiet line on the box's own page, and leaving is a
 * quiet item in its menu).
 *
 * JOINING writes `usesMap` and nothing else: the box's hands and cards are
 * untouched, and its sites start empty. LEAVING is refused while anything in
 * the box still names the map, because the compiler would refuse the box the
 * moment it left (E6), and a refusal that names what to change beats an
 * error appearing somewhere else. Its sites go in the same commit: a box off
 * the map with sites in its map shard is only a warning (W2) about positions
 * nothing reads, and one undo puts both back.
 */
export async function useProjectMap(
  session: ProjectSession, boxId: string, on: boolean, confirmed = false,
): Promise<OpenResult | { error: string } | { confirm: { title: string; body: string } } | { refused: LeaveRefusalDto }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const source = session.loaded.source!;
  const map = source.map;
  if (map === undefined) return { error: "this project has no map yet" };
  const name = box.box.box.title ?? effectiveGameId(box.box.box);
  if (on) {
    if (box.box.box.usesMap === true) return reload(session);
    // Its colour comes with it, in the same step: the first one no other box
    // on the map uses, or the one it had if that is still free (box-colours.ts).
    const colour = joiningColour(session, box);
    box.box.box.usesMap = true;
    const coloured = colourWrite(session, box, colour);
    return commit(session, "Use the project map", freshKey(),
      [boxWrite(session, box), ...(coloured ? [coloured] : [])]);
  }
  if (box.box.box.usesMap !== true) return reload(session);
  const why = whyStillOnMap(source, box, map.group);
  if (why !== undefined) {
    // Named by titles, quoted, and with the way to the thing to change: a
    // refusal that only says "change it first" leaves the author hunting
    // (the round-3 reviews).
    return {
      refused: {
        title: `"${name}" is still using the map`,
        body: `It can't leave the project map while ${why.said}. Change that first, then try again.`,
        ...(why.open !== undefined ? { open: why.open } : {}),
      },
    };
  }
  // The pins go with it (a box off the map has nowhere to draw them), so the
  // author is asked first, saying how many: one undo puts them back, but a menu
  // item that silently deleted a layout was the antagonist review's 1.3.
  const pinned = box.hands.hands.filter((h) => mapSites(box)[h.id] !== undefined).length;
  if (pinned > 0 && !confirmed) {
    return {
      confirm: {
        title: `Take "${name}" off the project map?`,
        body: `Its ${pinned === 1 ? "hand's position" : `${pinned} hands' positions`} on the map will be deleted, and the game can no longer ask this box about a zone. You can undo this.`,
      },
    };
  }
  delete box.box.box.usesMap;
  const forget = planForgetSites(session.loaded.dir, box, box.hands.hands.map((h) => h.id));
  // With every pin gone, the box's map shard holds nothing at all, so it goes
  // in the same step rather than staying as an empty husk in the folder. Not
  // when it still carries frames from before the project map, which are the
  // upgrade's to move and not this step's to throw away.
  const shardPath = mapPath(session.loaded.dir, box);
  const legacyFrames = (box.map?.map as { frames?: unknown[] } | undefined)?.frames ?? [];
  const husk = legacyFrames.length === 0 && (existsSync(shardPath) || forget.some((w) => w.path === shardPath));
  return commit(session, "Leave the project map", freshKey(), [
    boxWrite(session, box),
    ...forget.filter((w) => !husk || w.path !== shardPath).map((w) => ({ path: w.path, content: w.content })),
    ...(husk ? [{ path: shardPath, content: null }] : []),
  ]);
}

/**
 * Mark a tag group spatial, or stop.
 *
 * Turning it OFF leaves every polygon where it is. The zones are still zones and
 * the author may be toggling to compare, so throwing away geometry here would be
 * the most expensive undo in the app; validation says the outlines are currently
 * unshown, which is the honest report.
 *
 * A map is the PROJECT's since the project map (design/project-map-contract.md):
 * one per project, at the root, which boxes opt in to. So "make a map" of a box's
 * group LIFTS it there and puts the box on it, in one undo step, when the project
 * has no map yet, and is refused when it has one. "Stop being a map" moves the
 * group back into the box, which only the one box on the map may do: with others
 * on it, it is their map too. The minimal bridge until the editor has a project
 * map surface of its own.
 */
export async function setGroupSpatial(
  session: ProjectSession, boxId: string, groupId: string, on: boolean,
): Promise<Written> {
  const planned = planGroupSpatial(session, locateBox(session, boxId), groupId, on);
  if ("error" in planned) return planned;
  // Its own step, never `group:<id>`: that key coalesces a tag-group EDIT, and
  // sharing it folded "Make a map" into the edit typed before it, so one undo
  // took both (review 2026-10, item 13).
  return commit(session, planned.label, freshKey(), planned.writes);
}

/**
 * The map's "Create map": a new tag group that is already the project's map,
 * as ONE commit and one undo step (review 2026-10, item 13). It was a create
 * and a switch, two calls from the renderer and two steps for one gesture.
 * A project that has a map already is refused, and nothing is made.
 */
export async function createGroupAsMap(session: ProjectSession, boxId: string): Promise<{ result: OpenResult; groupId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const group: TagGroup = { id: newId("d"), gameId: freeGameId("new-map", new Set(box.tags.groups.map((d) => effectiveGameId(d)))), tags: [] };
  box.tags.groups.push(group);
  const planned = planGroupSpatial(session, box, group.id, true);
  if ("error" in planned) return refuse(session, planned.error);
  return commitMaking(session, "New map", freshKey(), planned.writes, { groupId: group.id });
}

/** What making a group a map (or not) writes, with the in-memory project
 *  changed to match; or why it may not. Refusals change nothing. */
function planGroupSpatial(
  session: ProjectSession, box: SourceBox | undefined, groupId: string, on: boolean,
): { label: string; writes: FileState[] } | { error: string } {
  const home = groupHome(session, box, groupId);
  const group = home?.group;
  if (!box || !home || !group) return gone("tag group");
  const source = session.loaded.source!;
  if (on && !home.project) {
    if (source.map !== undefined) {
      return { error: `this project has a map already ("${effectiveGameId(source.map.group)}"), and a project has one map` };
    }
    // A project from before the project map keeps its maps in its boxes. Making
    // another here would start a second map beside them; the upgrade lifts the
    // ones it has (main map-upgrade.ts), so that comes first.
    const old = source.boxes.find((b) => b.tags.groups.some((g) => g !== group && isSpatial(g)));
    if (old !== undefined) {
      return { error: `this project still keeps its map in the box "${effectiveGameId(old.box.box)}", from before the project map: upgrade the project first` };
    }
    box.tags.groups = box.tags.groups.filter((g) => g.id !== groupId);
    group.templates = withSpatialGroup(group, true)!;
    box.box.box.usesMap = true;
    const map: ProjectMapShard = { schema: PROJECTMAP_SCHEMA, group };
    return { label: "Make a map", writes: [
      tagsWrite(session, box),
      boxWrite(session, box),
      { path: projectMapPath(session.loaded.dir), content: canonicalStringify(map) },
    ] };
  }
  if (!on && home.project) {
    const others = source.boxes.filter((b) => b !== box && b.box.box.usesMap === true);
    if (others.length > 0) {
      return { error: `${others.map((b) => `"${effectiveGameId(b.box.box)}"`).join(", ")} ${others.length === 1 ? "is" : "are"} on the map too, so it cannot become this box's own group` };
    }
    // The pictures and the frames belong to the map, and a box's own group has
    // nowhere to keep them: turning the switch off used to delete both without a
    // word (the antagonist review, round 3, 1.3). Refused instead, saying what
    // would go; the zones' outlines are the group's and are kept either way.
    const pictures = backgroundsOf(group).length;
    const frames = framesOf(source.map).length;
    if (pictures > 0 || frames > 0) {
      const what = [pictures > 0 ? plural(pictures, "picture") : "", frames > 0 ? plural(frames, "frame") : ""].filter((x) => x !== "").join(" and ");
      return { error: `the map has ${what}, which a box's own tag group cannot keep. Remove ${pictures + frames === 1 ? "it" : "them"} from the map first, or leave it as the project's map` };
    }
    const templates = withSpatialGroup(group, false);
    if (templates === undefined) delete group.templates;
    else group.templates = templates;
    box.tags.groups.push(group);
    delete box.box.box.usesMap;
    return { label: "Stop being a map", writes: [
      tagsWrite(session, box),
      boxWrite(session, box),
      { path: projectMapPath(session.loaded.dir), content: null },
    ] };
  }
  const templates = withSpatialGroup(group, on);
  if (templates === undefined) delete group.templates;
  else group.templates = templates;
  return { label: on ? "Make a map" : "Stop being a map", writes: [home.write()] };
}

// --- zones ---------------------------------------------------------------------------

/**
 * A traced shape for a zone that does not exist yet: declare the tag AND give it the
 * outline, in ONE commit.
 *
 * One commit because it is one act. Two would be two undo steps, and Cmd+Z would
 * leave behind a tag with no shape: a zone the author never asked for, invisible on
 * the map and present in every tag picker in the project.
 */
export async function createZone(
  session: ProjectSession, boxId: string, groupId: string, polygon: { x: number; y: number }[],
  /** What the author called it as it was drawn (the sign-off round: eight rooms
   *  were eight renames of `new-zone`). Slugged here; blank or unusable falls
   *  back to "new-zone", so a shape is never lost to its name. */
  name?: string,
): Promise<{ result: OpenResult; tagId: string } | { error: string }> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  if (!finitePoints(polygon)) return refusedNumber;
  const taken = new Set(group.tags.map((v) => effectiveGameId(v)));
  const asked = gameIdify(name ?? "");
  const gameId = freeGameId(isValidGameId(asked) ? asked : "new-zone", taken);
  const tag: Tag = { id: newId("v"), gameId };
  const templates = withPolygon(tag, polygon);
  if (templates !== undefined) tag.templates = templates;
  group.tags.push(tag);
  // The tags shard and nothing else: a new outline drawn over existing sites
  // takes nobody in (see `bindSitesToZones`).
  return commitMaking(session, "Draw a zone", freshKey(), [home.write()], { tagId: tag.id });
}

/**
 * Set (or clear) a zone's outline. One commit per gesture, so one undo step per
 * traced or dragged shape.
 *
 * THE TAGS SHARD AND NOTHING ELSE. Moving, reshaping or clearing an outline does
 * not touch a single hand's `chosen` binding (the ruling of 2026-09-07): a zone
 * is geometry and a binding is content, and dragging a zone sixty points used to
 * strip `chosen` off every hand the outline left behind - one of them losing the
 * block entirely - with nothing said and the project left invalid. The canvas
 * has said this since 2026-08-06 (see `applyOutline` in map-view.ts); this side
 * had not caught up.
 */
export async function setZonePolygon(
  session: ProjectSession, boxId: string, groupId: string, tagId: string,
  polygon: { x: number; y: number }[] | undefined,
): Promise<{ result: OpenResult } | { error: string }> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  const tag = group?.tags.find((t) => t.id === tagId);
  if (!home || !group || !tag) return gone("zone");
  if (polygon !== undefined && !finitePoints(polygon)) return refusedNumber;
  const templates = withPolygon(tag, polygon);
  if (templates === undefined) delete tag.templates;
  else tag.templates = templates;
  // Keyed per zone, so dragging one shape's vertices coalesces into one step while
  // moving a different zone starts a new one.
  return commitMaking(session, polygon === undefined ? "Clear a zone" : "Shape a zone", `zone:${tagId}`, [home.write()], {});
}

/**
 * Move a zone through the stack: front, forward, backward, back.
 *
 * A VIEW gesture, and only that. Which zone is drawn in front of which changes
 * the picture; it changes no hand's binding, by the same ruling as a reshape
 * (2026-09-07). A pin that now looks as if it stands in the room rather than the
 * wing is a pin somebody can drag, and dragging it is the gesture that means it.
 *
 * A move that changes nothing returns without writing: "bring to front" on the
 * frontmost zone should not cost a file write or an undo step.
 */
export async function restackZone(
  session: ProjectSession, boxId: string, groupId: string, tagId: string, move: StackMove,
): Promise<{ result: OpenResult } | { error: string }> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  const tag = group?.tags.find((t) => t.id === tagId);
  if (!home || !group || !tag) return gone("zone");

  // Only DRAWN zones are in the stack: an undrawn tag has no place in a picture.
  const drawn = group.tags.filter((t) => polygonOf(t) !== undefined)
    .map((t) => { const z = zOf(t); return { id: t.id, ...(z !== undefined ? { z } : {}) }; });
  const z = restack(drawn, tagId, move);
  if (z === undefined) return { result: reload(session) };

  tag.templates = withZ(tag, z);
  // Its OWN undo step, not the `zone:<id>` key a reshape uses. That key exists to
  // coalesce a continuous gesture - dragging one shape's vertices is one edit,
  // however many frames it took - and a restack is a discrete command from a
  // menu. Sharing the key made "bring to front" undo the reshaping that happened
  // before it, which is not what anybody pressing undo once is asking for.
  return commitMaking(session, "Restack a zone", freshKey(), [home.write()], {});
}

// --- the pictures behind a map ----------------------------------------------------------

/**
 * Import a picture behind a map: copy the bytes in, and place them.
 *
 * ONE act, which is why main reads the image's size itself (`imageSize`) rather
 * than letting the renderer load it and place it afterwards: that would be two
 * commits and two undo steps for one gesture. The caller passes its CAMERA - the
 * viewport size, the zoom and where the drop landed - and the rectangle is
 * computed here by the shared rule.
 *
 * The bytes are written straight to disk and are NOT in the undo history, which
 * is deliberate. Undoing the import removes the entry and leaves the file in
 * `assets/`: an orphan file is a much better outcome than an undo that deletes
 * somebody's only copy of a site plan, and a redo finds it still there.
 *
 * The new picture goes to the FRONT of the stack, because an author who has just
 * dropped something wants to see it.
 */
export async function addBackground(
  session: ProjectSession, boxId: string, groupId: string,
  source: { name: string; bytes: Uint8Array },
  place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
): Promise<{ result: OpenResult; file: string } | { error: string }> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  if (!home.project && !isSpatial(group)) return { error: `"${effectiveGameId(group)}" is not a map` };
  if (!allFinite(place.view.width, place.view.height, place.scale, place.at.x, place.at.y)) return refusedNumber;

  // The project's one assets folder (design/project-map-contract.md 1.4).
  const dir = join(session.loaded.dir, ASSETS_DIR);
  // Taken names come from BOTH the folder and the bag: a file on disk nothing
  // references is still a name in use, and an entry whose file is missing still
  // owns its name.
  const onDisk = existsSync(dir) ? readdirSync(dir) : [];
  const taken = new Set([...onDisk, ...backgroundsOf(group).map((b) => b.file)]);
  const file = freeAssetName(basename(source.name), taken);
  if (!isSafeAssetName(file)) return { error: `"${source.name}" is not a usable file name` };

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), source.bytes);
  } catch (e) {
    return { error: `couldn't copy the image: ${e instanceof Error ? e.message : String(e)}` };
  }

  // A format we cannot measure still imports: a square guess is a better outcome
  // than refusing somebody's map (see `imageSize`).
  const natural = imageSize(source.bytes) ?? { width: 1000, height: 1000 };
  const rect = droppedRect(natural, place.view, place.scale, place.at);
  const entry: SpatialBackground = { id: newId("g"), file, ...rect };
  group.templates = withBackgrounds(group, [...backgroundsOf(group), entry]);

  return commitMaking(session, "Add a background", freshKey(), [home.write()], { file });
}

/** What one background edit may change. Geometry and flags in one call, because
 *  they are all "this picture, but different" and a separate mutation each would
 *  be five functions agreeing with each other by hand. */
export interface BackgroundEdit {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
}

/**
 * Change one background: move it, scale it, fade it, hide it, lock it.
 *
 * `coalesce` decides whether this joins the previous edit as one undo step. A
 * drag or a scale is a continuous gesture and coalesces (the same rule vertex
 * dragging uses); a lock, a hide or a fade is a discrete command and gets its own
 * step. Sharing one key for both made "lock" undo the dragging that came before
 * it, which is the mistake the zone restack already taught us once.
 */
export async function editBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string,
  edit: BackgroundEdit, opts: { coalesce?: boolean } = {},
): Promise<Written> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  const current = backgroundsOf(group);
  const at = current.findIndex((b) => b.id === backgroundId);
  if (at < 0) return gone("background");
  const numbers = [edit.x, edit.y, edit.width, edit.height, edit.opacity].filter((v) => v !== undefined);
  if (!allFinite(...numbers)) return refusedNumber;

  const was = current[at]!;
  const next: SpatialBackground = {
    ...was,
    ...(edit.x !== undefined ? { x: edit.x } : {}),
    ...(edit.y !== undefined ? { y: edit.y } : {}),
    // A picture with no area cannot be seen or grabbed to fix, so a scale is
    // floored rather than trusted.
    ...(edit.width !== undefined ? { width: Math.max(1, edit.width) } : {}),
    ...(edit.height !== undefined ? { height: Math.max(1, edit.height) } : {}),
    ...(edit.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, edit.opacity)) } : {}),
  };
  // Flags are cleared rather than written false: an absent key is the default
  // everywhere in these shards, and `hidden: false` is noise in a merge.
  if (edit.hidden !== undefined) { if (edit.hidden) next.hidden = true; else delete next.hidden; }
  if (edit.locked !== undefined) { if (edit.locked) next.locked = true; else delete next.locked; }

  const updated = [...current];
  updated[at] = next;
  group.templates = withBackgrounds(group, updated);
  const key = opts.coalesce === true ? `bg:${backgroundId}` : freshKey();
  return commit(session, "Edit a background", key, [home.write()]);
}

/** Move a background through the stack, among the OTHER BACKGROUNDS only: they are
 *  a band below the zones, so no move can put a picture over one. */
export async function restackBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string, move: StackMove,
): Promise<Written> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  const current = backgroundsOf(group);
  const z = restack(current, backgroundId, move);
  if (z === undefined) return reload(session);

  const updated = current.map((b) => (b.id === backgroundId ? { ...b, z } : b));
  group.templates = withBackgrounds(group, updated);
  return commit(session, "Restack a background", freshKey(), [home.write()]);
}

/**
 * Take a picture off the map.
 *
 * The ENTRY goes; the file stays, exactly as an undone import leaves its bytes.
 * It becomes an orphan, and orphans are swept when the session ends (by which
 * point no undo can want them back) - so nothing here deletes anything an undo
 * might need, and nothing accumulates for ever either.
 */
export async function removeBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string,
): Promise<Written> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  const current = backgroundsOf(group);
  if (!current.some((b) => b.id === backgroundId)) return gone("background");
  group.templates = withBackgrounds(group, current.filter((b) => b.id !== backgroundId));
  return commit(session, "Remove a background", freshKey(), [home.write()]);
}

// --- sites ---------------------------------------------------------------------------

/** Take hands off the map. The hands themselves are untouched: only their sites. */
export async function removeSitesFromMap(
  session: ProjectSession, boxId: string, handIds: string[],
): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const writes = planForgetSites(session.loaded.dir, box, handIds);
  if (writes.length === 0) return reload(session);
  return commit(session, "Remove from the map", freshKey("map"),
    writes.map((w) => ({ path: w.path, content: w.content })));
}

/**
 * Record where a box's hand sites now sit, and REBIND the hands they stand for.
 *
 * The move the map exists for (graphical-views 2): dragging a pin from the docks
 * to the market is not a cosmetic act, it edits the hand's chosen tag. So this
 * writes two shards at once, and deliberately in ONE commit: a position and a
 * binding that arrived from the same gesture must undo as the same gesture, or
 * an undo leaves a pin in the market bound to the docks.
 *
 * Which zone a pin landed in is decided HERE, from where it was dropped over
 * the outlines, by the one rule (`bindSitesToZones`): a pin dropped in a zone
 * is rebound to it, and one dropped on open ground is left loose, its binding
 * cleared. The map draws a pin by its BINDING, so a pin that has not been
 * rebound still shows the colour of the zone that owns it.
 *
 * `bindHand` refuses anything that is not the hand's own to change, so a pin
 * whose group is fixed by its template moves without dragging its siblings.
 */
export async function moveSitesOnMap(
  session: ProjectSession, boxId: string, groupId: string, placements: MapSiteMove[],
): Promise<{ result: OpenResult; rebound: SiteRebinding[] } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");

  if (!finitePoints(placements)) return refusedNumber;
  const moved: Record<string, { x: number; y: number }> = {};
  for (const p of placements) moved[p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
  const rebound = bindSitesToZones(boxWithMap(session.loaded.source, box), groupId, moved);

  // One or two files: the map shard, and - for a project whose map still lives in
  // its view shard - the view shard without it. The move out rides the same
  // commit as the drag that triggered it, so it undoes as one step too.
  const planned = planMapSites(session.loaded.dir, box, placements);
  // Nothing to write: the sites landed where they already were and nobody moved
  // zone. Still a fresh read, so the caller's DTOs and problems are current.
  if (planned.length === 0 && rebound.length === 0) return { result: reload(session), rebound };
  const writes = [
    ...planned.map((w) => ({ path: w.path, content: w.content })),
    ...(rebound.length > 0 ? [handsWrite(session, box)] : []),
  ];
  // Named for what the author did, since it is what an undo will offer back. One
  // commit: a position and a binding from the same gesture undo as one gesture.
  return commitMaking(session, rebound.length > 0 ? "Move a hand on the map" : "Move hands on the map",
    freshKey("map"), writes, { rebound });
}
