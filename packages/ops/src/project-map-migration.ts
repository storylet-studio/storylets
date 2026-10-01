// ---------------------------------------------------------------------------
// The project map migration (design/project-map-contract.md 4.2): the second
// migration `storyletengine format` carries, by the same argument as the first
// (where a value BELONGS is part of canonical form).
//
// Before the project map, a map was a spatial tag group inside a box, and boxes
// that shared a place each carried a copy (Port Meridian carried four). Now there
// is one zone group above the boxes, a box opts in, and only its SITES stay its
// own. This plans that move:
//
//   1-3. every box's spatial group, in folder order; the first box's copy (or a
//        project map already there) survives with its ids
//   4.   every other copy is compared to it, and the migration REFUSES on any
//        difference that changes play or the drawing, one sentence per
//        difference (D6, ruled 2026-10-01). Cosmetics take the survivor's
//        silently; a differing picture list takes the survivor's with a warning
//   5.   every other box's references are rewritten to the survivor's ids,
//        matched by tag gameId
//   6.   the groups leave the boxes; every box that held a copy or placed a
//        site opts in
//   7.   map frames move to the project map shard, box map shards keep sites;
//        map comments move as 1.1 says
//   8.   the survivor's pictures move from `<box>/assets/` to `<project>/assets/`
//   9.   a contract's box-qualified zone address is rewritten to the short form
//
// Before any of that is planned, a PRE-FLIGHT refuses the move when it would
// itself break a compile rule the old project kept: a box group with the map's
// name (E3), a box tag with a zone's name (E4), or a box that joins the map for
// its placed hands and types a property the map also declares differently. Each
// is one sentence naming the rename, as a differing copy is, so `format` never
// leaves behind a project that does not compile.
//
// A project already ON the project map whose boxes still hold map frames (a
// collaborator's edit from before, a hand edit) has those frames moved and
// nothing else: W3 names `format`, so `format` has to do it.
//
// The plan is made on a COPY of the parsed source and serialised whole, shard by
// shard, through the canonical writer: never a text edit of a shard. A project
// with no spatial group in any box and no stray frames plans nothing, which is
// what makes a second run a no-op.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join } from "node:path";
import { boxMapOf, canonicalStringify, describeDeclarations, sameDeclaration } from "@storylet-studio/compiler";
import type { Issue, SourceBox, SourceProject } from "@storylet-studio/compiler";
import {
  MAP_SCHEMA, NOTES_SCHEMA, PROJECTMAP_SCHEMA, SHARD_EXTENSIONS, VIEW_SCHEMA,
  backgroundsOf, commentsOf, contractPropertyPath, effectiveGameId, isHoleRef, isSpatial, polygonOf,
} from "@storylet-studio/model";
import type {
  Comment, ContractProperty, Frame, MapShard, NotesShard, ProjectMapShard, PropertyDecl, TagGroup, ViewShard,
} from "@storylet-studio/model";
import { ASSETS_DIR } from "./assets.js";

/** A file the migration moves rather than rewrites: a picture, which no
 *  `PlannedWrite` can carry (its content is text). Absolute paths. */
export interface PlannedMove {
  from: string;
  to: string;
}

export interface ProjectMapMigration {
  /** Absolute path -> the shard's new canonical content. */
  writes: Map<string, string>;
  /** Shards the move leaves with nothing in them (a box map shard that held
   *  only frames, a view shard that held only a map). Absolute paths. */
  removed: string[];
  moved: PlannedMove[];
  /** Refusals (errors: nothing is planned) and warnings (planned anyway). */
  issues: Issue[];
  /** What the migration did, a line each, for a person reading the output. */
  report: string[];
}

const EMPTY = (): ProjectMapMigration => ({ writes: new Map(), removed: [], moved: [], issues: [], report: [] });

/** The canvas a box's map was drawn on before, and the project map's now. */
const OLD_MAP_CANVAS = (boxId: string): string => `map:${boxId}`;
export const PROJECT_MAP_CANVAS = "map";

interface Copy {
  box: SourceBox;
  boxName: string;
  group: TagGroup;
}

/** A declaration list as a comparable value: order is cosmetic, content is not. */
const declKey = (decls: PropertyDecl[] | undefined): string =>
  canonicalStringify([...(decls ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));

const polygonKey = (tag: TagGroup["tags"][number]): string =>
  canonicalStringify((polygonOf(tag) ?? []).map((p) => [p.x, p.y]));

/**
 * The sentences that refuse a copy, one per difference that changes play or the
 * drawing (4.2 step 4). Empty when the copy may be folded into the survivor.
 */
function differences(copy: Copy, survivor: Copy, survivorLabel: string): string[] {
  const out: string[] = [];
  const name = `"${copy.boxName}"`;
  const tail = "make them agree, or delete the zone from one, then run format again";
  const agree = "make them agree, then run format again";
  const theirs = new Map(survivor.group.tags.map((t) => [effectiveGameId(t), t]));
  const ours = new Map(copy.group.tags.map((t) => [effectiveGameId(t), t]));
  for (const [zone, tag] of ours) {
    const kept = theirs.get(zone);
    if (kept === undefined) {
      out.push(`${name} has the zone "${zone}", which ${survivorLabel} does not; ${tail}`);
      continue;
    }
    if (polygonKey(tag) !== polygonKey(kept)) {
      out.push(`${name} draws "${zone}" differently from ${survivorLabel}; ${tail}`);
    }
    if (declKey(tag.properties) !== declKey(kept.properties)) {
      out.push(`${name} declares the properties of "${zone}" differently from ${survivorLabel}; ${tail}`);
    }
    if (canonicalStringify(tag.values ?? {}) !== canonicalStringify(kept.values ?? {})) {
      out.push(`${name} starts "${zone}" at different values from ${survivorLabel}; ${tail}`);
    }
  }
  for (const zone of theirs.keys()) {
    if (!ours.has(zone)) out.push(`${name} has no zone "${zone}", which ${survivorLabel} has; ${tail}`);
  }
  if (declKey(copy.group.properties) !== declKey(survivor.group.properties)) {
    out.push(`${name} declares the map's properties differently from ${survivorLabel}; ${agree}`);
  }
  if ((copy.group.boundBy ?? "") !== (survivor.group.boundBy ?? "")) {
    out.push(`${name} binds the map to state differently from ${survivorLabel}; ${agree}`);
  }
  if ((copy.group.required === true) !== (survivor.group.required === true)) {
    out.push(`${name} makes the map required where ${survivorLabel} does not, or the other way round; ${agree}`);
  }
  return out;
}

/** Rewrite a reference record's keys and values through the id map. Hole
 *  references (`@hand.zone`) are values that name a property, not a tag, and
 *  are left as they are. */
function remapRecord(record: Record<string, string> | undefined, ids: Map<string, string>): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) out[ids.get(k) ?? k] = isHoleRef(v) ? v : (ids.get(v) ?? v);
  return out;
}

/** The view shard's legacy map and a map shard's frames, both typed out of the
 *  model now: read here, once, to be moved. */
const framesIn = (map: unknown): Frame[] => {
  const frames = (map as { frames?: unknown } | undefined)?.frames;
  return Array.isArray(frames) ? frames as Frame[] : [];
};

/**
 * The pre-flight: every compile rule the MOVE itself would newly break, each
 * refused in one sentence naming the rename to make, as a differing copy is.
 * Before the move a group or tag name is the box's own (two boxes may each
 * have a "forest"); after it, the map's group name and every zone name mean
 * one thing across the project (design/project-map-contract.md 1.6).
 *
 *   - E3: a box group with the map's name, in any box, on the map or not
 *   - E4: a box tag with a zone's name, in any box, on the map or not
 *   - the composed `@hand` (4.1): a box with no copy that joins the map because
 *     it has hands placed on it gains the map's property declarations, and a
 *     box tag declaring one of those names differently (another type, other
 *     stages, other values: the compiler's own `sameDeclaration`) no longer
 *     compiles
 *
 * The rules the move cannot newly trip are left to the compiler, which already
 * reports them: "place" was reserved in a box before, ids are unique project-
 * wide already, and a box that held a copy composed it into `@hand` already.
 */
function preflight(original: SourceProject, map: TagGroup): Issue[] {
  const out: Issue[] = [];
  const mapName = effectiveGameId(map);
  const zones = new Set(map.tags.map((t) => effectiveGameId(t)));
  /** The map's own property declarations by name, group then tags, first wins. */
  const mapDecls = new Map<string, PropertyDecl>();
  for (const decl of [...(map.properties ?? []), ...map.tags.flatMap((t) => t.properties ?? [])]) {
    if (!mapDecls.has(decl.name)) mapDecls.set(decl.name, decl);
  }
  for (const box of original.boxes) {
    const boxName = effectiveGameId(box.box.box);
    const path = `${box.path}/tags`;
    const own = box.tags.groups.filter((g) => !isSpatial(g));
    for (const group of own) {
      const groupName = effectiveGameId(group);
      if (groupName === mapName) {
        out.push({ severity: "error", path, where: groupName,
          message: `box "${boxName}" has a tag group "${groupName}", the name the project map takes, and a group name will mean one thing across the project;`
            + ` rename the group in "${boxName}", then run format again` });
      }
      for (const tag of group.tags) {
        const tagName = effectiveGameId(tag);
        if (!zones.has(tagName)) continue;
        out.push({ severity: "error", path, where: tagName,
          message: `box "${boxName}" has a tag "${tagName}" in its group "${groupName}", and "${tagName}" is a zone of the map, whose name will mean one thing across the project;`
            + ` rename the tag in "${boxName}", then run format again` });
      }
    }
    // Only a box that joins the map for its placed hands gains declarations it
    // never composed before; a box that held a copy composed the same ones.
    const joins = box.box.box.usesMap !== true
      && !box.tags.groups.some((g) => isSpatial(g))
      && Object.keys(boxMapOf(box)?.sites ?? {}).length > 0;
    if (!joins) continue;
    const said = new Set<string>();
    for (const group of own) {
      for (const [decl, on] of [
        ...(group.properties ?? []).map((d) => [d, `the group "${effectiveGameId(group)}"`] as const),
        ...group.tags.flatMap((t) => (t.properties ?? []).map((d) => [d, `"${effectiveGameId(group)}/${effectiveGameId(t)}"`] as const)),
      ]) {
        const theirs = mapDecls.get(decl.name);
        if (theirs === undefined || sameDeclaration(theirs, decl) || said.has(decl.name)) continue;
        said.add(decl.name);
        const [mine, onMap] = describeDeclarations(decl, theirs);
        out.push({ severity: "error", path, where: decl.name,
          message: `box "${boxName}" joins the project map because it has hands placed on it, and it declares @hand.${decl.name} as ${mine} on ${on} where the map declares it as ${onMap};`
            + ` rename the property in "${boxName}", or make the two agree, then run format again` });
      }
    }
  }
  return out;
}

/**
 * Plan the project map migration for a loaded project. Pure: nothing on disk is
 * touched, and `source` is not mutated.
 */
export function planProjectMapMigration(dir: string, original: SourceProject): ProjectMapMigration {
  const result = EMPTY();
  const copies: Copy[] = [];
  for (const box of original.boxes) {
    for (const group of box.tags.groups) {
      if (isSpatial(group)) copies.push({ box, boxName: effectiveGameId(box.box.box), group });
    }
  }
  // Frames left in a box's map shard when the project already has its map: the
  // one thing W3 sends the author here to move. Nothing else is migrated then.
  const strayFrames = original.map !== undefined
    && original.boxes.some((box) => framesIn(boxMapOf(box)).length > 0);
  if (copies.length === 0 && !strayFrames) return result;
  const migrating = copies.length > 0;

  // Several maps per project is parked: two distinct names (two maps, or one
  // box with two) are refused, naming them, rather than guessed at.
  const names = [...new Set([
    ...(original.map !== undefined ? [effectiveGameId(original.map.group)] : []),
    ...copies.map((c) => effectiveGameId(c.group)),
  ])];
  if (names.length > 1) {
    result.issues.push({
      severity: "error", path: ".",
      message: `this project has ${names.length} maps (${names.map((n) => `"${n}"`).join(", ")}), and a project has one map now;`
        + " keep one, make the others ordinary tag groups, then run format again",
    });
    return result;
  }

  // The survivor: a project map already there, or the first box's copy, ids and
  // all (Q11). Folder order is source order (`parseProjectFiles` sorts).
  const source = structuredClone(original);
  const boxOf = (box: SourceBox): SourceBox => source.boxes.find((b) => b.path === box.path)!;
  const fromRoot = original.map !== undefined;
  const survivor: Copy = fromRoot
    ? { box: undefined as unknown as SourceBox, boxName: "", group: original.map!.group }
    : copies[0]!;
  const survivorLabel = fromRoot
    ? "the project map"
    : `"${survivor.boxName}" (the first box, whose map is kept)`;

  const others = fromRoot ? copies : copies.slice(1);
  for (const copy of others) {
    for (const message of differences(copy, survivor, survivorLabel)) {
      result.issues.push({ severity: "error", path: `${copy.box.path}/tags`, where: effectiveGameId(copy.group), message });
    }
  }
  for (const issue of preflight(original, survivor.group)) result.issues.push(issue);
  if (result.issues.some((i) => i.severity === "error")) return result;

  // Cosmetic only from here on, apart from the pictures, which are named.
  const keptPictures = new Set(backgroundsOf(survivor.group).map((b) => b.file));
  for (const copy of others) {
    const dropped = backgroundsOf(copy.group).map((b) => b.file).filter((f) => !keptPictures.has(f));
    if (dropped.length > 0) {
      result.issues.push({
        severity: "warning", path: `${copy.box.path}/tags`, where: effectiveGameId(copy.group),
        message: `"${copy.boxName}" puts ${dropped.map((f) => `"${f}"`).join(", ")} behind its map and ${survivorLabel} does not;`
          + ` the project map keeps ${survivorLabel === "the project map" ? "its own" : "the first box's"} pictures, and these stay in ${copy.box.path}/${ASSETS_DIR}/`,
      });
    }
  }

  // Every copy's ids, mapped to the survivor's by gameId (step 5). The
  // survivor's own map to themselves and are left out.
  const ids = new Map<string, string>();
  const survivorTags = new Map(survivor.group.tags.map((t) => [effectiveGameId(t), t.id]));
  for (const copy of others) {
    if (copy.group.id !== survivor.group.id) ids.set(copy.group.id, survivor.group.id);
    for (const tag of copy.group.tags) {
      const kept = survivorTags.get(effectiveGameId(tag))!;
      if (tag.id !== kept) ids.set(tag.id, kept);
    }
  }
  const zoneIds = new Set([survivor.group.id, ...survivor.group.tags.map((t) => t.id)]);

  const write = (path: string, value: unknown): void => { result.writes.set(path, canonicalStringify(value)); };
  const shardPath = (box: SourceBox, name: string): string => join(dir, box.path, name);
  const rewritten = new Set<string>();

  // The project map shard: the survivor's group whole, frames from every box.
  const frames: Frame[] = [...framesIn(original.map)];
  const projectMap: ProjectMapShard = {
    ...(original.map ?? {}),
    schema: PROJECTMAP_SCHEMA,
    group: structuredClone(survivor.group),
  };

  // Root comments: whatever is there, plus the map's own threads moved up.
  const rootComments: Comment[] = [...commentsOf(original.notes)];
  let rootCommentsMoved = 0;

  const copyBoxes = new Set(copies.map((c) => c.box.path));
  for (const originalBox of original.boxes) {
    const box = boxOf(originalBox);
    const boxName = effectiveGameId(box.box.box);
    const hadCopy = copyBoxes.has(box.path);

    // Step 6: the group leaves the box.
    if (hadCopy) {
      box.tags.groups = box.tags.groups.filter((g) => !isSpatial(g));
      write(shardPath(box, `tags${SHARD_EXTENSIONS.tags}`), box.tags);
    }

    // Step 5: references, in every box other than the survivor's (whose ids are
    // the survivor's already). A box that held no copy cannot name one.
    if (hadCopy && ids.size > 0) {
      let touched = false;
      for (const deck of box.decks) {
        let deckTouched = false;
        for (const card of deck.shard.cards) {
          if (card.tags === undefined) continue;
          const next: Record<string, string[]> = {};
          for (const [g, tags] of Object.entries(card.tags)) next[ids.get(g) ?? g] = tags.map((t) => ids.get(t) ?? t);
          if (canonicalStringify(next) !== canonicalStringify(card.tags)) { card.tags = next; deckTouched = true; }
        }
        if (deckTouched) { write(join(dir, deck.path), deck.shard); touched = true; }
      }
      let handsTouched = false;
      for (const template of box.hands.templates) {
        const bindings = remapRecord(template.bindings, ids);
        if (bindings !== undefined && canonicalStringify(bindings) !== canonicalStringify(template.bindings)) {
          template.bindings = bindings; handsTouched = true;
        }
        if (template.chooses !== undefined) {
          const chooses = template.chooses.map((g) => ids.get(g) ?? g);
          if (chooses.join("\n") !== template.chooses.join("\n")) { template.chooses = chooses; handsTouched = true; }
        }
      }
      for (const hand of box.hands.hands) {
        const chosen = remapRecord(hand.chosen, ids);
        if (chosen !== undefined && canonicalStringify(chosen) !== canonicalStringify(hand.chosen)) {
          hand.chosen = chosen; handsTouched = true;
        }
        if (hand.rule !== undefined) {
          const bindings = remapRecord(hand.rule.bindings, ids);
          if (bindings !== undefined && canonicalStringify(bindings) !== canonicalStringify(hand.rule.bindings)) {
            hand.rule = { ...hand.rule, bindings }; handsTouched = true;
          }
        }
      }
      if (handsTouched) { write(shardPath(box, `hands${SHARD_EXTENSIONS.hands}`), box.hands); touched = true; }
      if (touched) rewritten.add(boxName);
    }

    // Step 6: opt in every box that held a copy or placed a site.
    const map = boxMapOf(box);
    const placed = Object.keys(map?.sites ?? {}).length > 0;
    if (migrating && (hadCopy || placed) && box.box.box.usesMap !== true) {
      box.box.box.usesMap = true;
      write(shardPath(box, `box${SHARD_EXTENSIONS.box}`), box.box);
      result.report.push(`box "${boxName}" is on the project map`);
    }

    // Step 7: frames up to the project map, sites stay. A map still in its view
    // shard (the first migration's case) is moved in the same breath.
    const boxFrames = framesIn(map);
    frames.push(...boxFrames);
    if (map !== undefined && (boxFrames.length > 0 || box.view?.map !== undefined)) {
      const sites = map.sites;
      const mapShardPath = shardPath(box, `map${SHARD_EXTENSIONS.map}`);
      if (sites !== undefined && Object.keys(sites).length > 0) {
        const shard: MapShard = { schema: MAP_SCHEMA, map: { sites } };
        write(mapShardPath, shard);
      } else if (box.map !== undefined) {
        result.removed.push(mapShardPath);
      }
      if (box.view?.map !== undefined) {
        const view: ViewShard = { ...box.view, schema: VIEW_SCHEMA };
        delete view.map;
        const viewPath = shardPath(box, `view${SHARD_EXTENSIONS.view}`);
        if (Object.keys(view).length === 1) result.removed.push(viewPath); else write(viewPath, view);
      }
    }

    // Step 7, comments (1.1): a thread about the map or a zone moves to the
    // root notes on canvas `map`; a thread about a SITE stays in the box,
    // because a hand belongs to one, with its canvas renamed.
    if (migrating && box.notes !== undefined) {
      const kept: Comment[] = [];
      let changed = false;
      for (const thread of commentsOf(box.notes)) {
        const onOldMap = thread.mark?.canvas === OLD_MAP_CANVAS(box.box.box.id);
        // Anchored to the old map canvas itself: a thread about the map.
        const anchor = onOldMap && thread.anchor === thread.mark!.canvas
          ? PROJECT_MAP_CANVAS : (ids.get(thread.anchor) ?? thread.anchor);
        const aboutMap = anchor === PROJECT_MAP_CANVAS || zoneIds.has(anchor);
        const next: Comment = {
          ...thread, anchor,
          ...(onOldMap ? { mark: { ...thread.mark!, canvas: PROJECT_MAP_CANVAS } } : {}),
        };
        if (canonicalStringify(next) !== canonicalStringify(thread)) changed = true;
        if (aboutMap) { rootComments.push(next); rootCommentsMoved++; changed = true; } else kept.push(next);
      }
      if (changed) {
        const shard: NotesShard = { ...box.notes, schema: NOTES_SCHEMA };
        if (kept.length > 0) shard.comments = kept; else delete shard.comments;
        write(shardPath(box, `notes${SHARD_EXTENSIONS.notes}`), shard);
      }
    }
  }

  // Step 7, frames: the union, ids already unique (they were generated).
  const seenFrames = new Set<string>();
  const union = frames.filter((f) => (seenFrames.has(f.id) ? false : (seenFrames.add(f.id), true)));
  if (union.length > 0) projectMap.frames = union; else delete projectMap.frames;
  const movedFrames = union.length - framesIn(original.map).length;
  write(join(dir, `map${SHARD_EXTENSIONS.map}`), projectMap);
  if (rootCommentsMoved > 0) {
    write(join(dir, `notes${SHARD_EXTENSIONS.notes}`), { ...(original.notes ?? {}), schema: NOTES_SCHEMA, comments: rootComments });
  }

  // Step 8: the survivor's pictures to the project's one folder. A picture the
  // map names and the folder does not hold is said, not moved; one already at
  // the root is left where it is, since the root is where it belongs.
  if (!fromRoot) {
    for (const file of new Set(backgroundsOf(survivor.group).map((b) => b.file))) {
      const from = join(dir, survivor.box.path, ASSETS_DIR, file);
      const to = join(dir, ASSETS_DIR, file);
      if (existsSync(to)) continue;
      if (!existsSync(from)) {
        result.issues.push({ severity: "warning", path: `${survivor.box.path}/${ASSETS_DIR}`, where: file,
          message: `the map puts "${file}" behind it, and ${survivor.box.path}/${ASSETS_DIR}/ has no such file, so there is nothing to move` });
        continue;
      }
      result.moved.push({ from, to });
    }
  }

  // Step 9: a contract's box-qualified address of a zone is one the engine now
  // refuses; the short form is the one that works.
  const zones = new Set(survivor.group.tags.map((t) => effectiveGameId(t)));
  const boxNames = new Set(original.boxes.map((b) => effectiveGameId(b.box.box)));
  const shorten = (path: string): string => {
    const m = /^value\.([^./]+)\/([^.]+)\.(.+)$/.exec(path);
    return m !== null && boxNames.has(m[1]!) && zones.has(m[2]!) ? `value.${m[2]}.${m[3]}` : path;
  };
  for (const contract of migrating ? source.contracts : []) {
    let changed = false;
    const properties = (contract.shard.properties ?? []).map((p): ContractProperty => {
      const path = contractPropertyPath(p);
      const short = shorten(path);
      if (short === path) return p;
      changed = true;
      result.report.push(`${contract.path}: "${path}" is now "${short}"`);
      return typeof p === "string" ? short : { ...p, path: short };
    });
    if (changed) write(join(dir, contract.path), { ...contract.shard, properties });
  }

  const survivorName = fromRoot ? "the project map" : `the map of "${survivor.boxName}"`;
  if (migrating) {
    result.report.unshift(
      `${survivorName} is the project map ("${effectiveGameId(survivor.group)}", ${survivor.group.tags.length} zones)`
        + (others.length > 0 ? `; the copies in ${others.map((c) => `"${c.boxName}"`).join(", ")} are folded into it` : ""),
    );
  }
  for (const name of rewritten) result.report.push(`box "${name}" now names the project map's zones by its ids`);
  if (movedFrames > 0) result.report.push(`${movedFrames} frame(s) moved to the project map`);
  if (rootCommentsMoved > 0) result.report.push(`${rootCommentsMoved} map comment(s) moved to the project's notes`);
  for (const move of result.moved) result.report.push(`picture moved to ${ASSETS_DIR}/${move.to.split("/").pop()}`);
  return result;
}
