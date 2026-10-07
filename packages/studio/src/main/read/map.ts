// ---------------------------------------------------------------------------
// What the maps draw. The project map page (the surfacing review's plan item
// 2): the project map's zones and pictures ONCE, and every box on the map as a
// layer of its own sites. One box's map, for the Board and the box's own view.
// And one zone, for the map page's side panel.
//
// Boxes not on the map are not sent at all: a box that has not opted in is
// never mentioned on the map (the author's ruling, 2026-10-01). Projections
// only: the one write in front of the two map views (a box's colour, stored
// the first time it is drawn) is mutate/map.ts's.
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "node:fs";
import { assetPath, boxColourOf, canvasFurniture, mapSites, movesIn, tagsOfHand } from "@storylet-studio/ops";
import { PLACE_GROUP, backgroundsOf, effectiveGameId, framesOf, handBinding, isSpatial, polygonOf, stacked, zOf } from "@storylet-studio/model";
import type { PropertyDecl, TagGroup } from "@storylet-studio/model";
import { byDisplay, holeDecls } from "../project.js";
import type { ProjectSession } from "../project.js";
import { axisBox } from "../project.js";
import { asText } from "../decls.js";
import { furnitureDto } from "./canvas.js";
import { boxCards, tiersAt } from "./details.js";
import { PROJECT_MAP_ASSETS, assetUrl } from "../../shared/api.js";
import type {
  BoxMapDto, HandCardRef, MapBackgroundDto, MapSiteDto, MapZoneBoxDto, MapZoneDetailDto, MapZoneDto, MapZonePropertyDto,
  ProjectMapDto, ProjectMapLayerDto, ProjectMapSiteDto, ProjectMapViewDto,
} from "../../shared/api.js";

/** A picture's URL, stamped with its file's modified time: the protocol handler
 *  reads only the host and path, and the renderers' picture caches key by URL,
 *  so a picture replaced on disk under the same name is fetched afresh. */
export function stampedAssetUrl(owner: string, file: string, full: string | undefined): string {
  const url = assetUrl(owner, file);
  if (full === undefined) return url;   // a name refused as unsafe: nothing to stamp
  try { return `${url}?v=${Math.floor(statSync(full).mtimeMs)}`; } catch { return url; }   // missing: the view draws a placeholder
}

/** A map group's zones as the views draw them: the drawn ones in DRAW order,
 *  back to front, so every view paints the stack right by painting the list in
 *  order and none of them has to know the rule; and the tags with no outline
 *  yet, beside them. */
export function zoneDtos(group: TagGroup): { zones: MapZoneDto[]; undrawn: { id: string; gameId: string }[] } {
  const zones: MapZoneDto[] = [];
  const undrawn: { id: string; gameId: string }[] = [];
  for (const tag of group.tags) {
    const polygon = polygonOf(tag);
    if (!polygon) { undrawn.push({ id: tag.id, gameId: effectiveGameId(tag) }); continue; }
    const z = zOf(tag);
    zones.push({ id: tag.id, gameId: effectiveGameId(tag), polygon, ...(z !== undefined ? { z } : {}) });
  }
  return { zones: stacked(zones), undrawn };
}

/** The pictures behind a map, already in draw order and already checked
 *  against the disk: a view should draw a placeholder, not discover a 404.
 *  `owner` is the asset URL's host: the box being viewed, or the project map's. */
export function backgroundDtos(dir: string, group: TagGroup, owner: string): MapBackgroundDto[] {
  return backgroundsOf(group).map((b) => {
    const full = assetPath(dir, b.file);
    return {
      id: b.id, file: b.file, url: stampedAssetUrl(owner, b.file, full),
      x: b.x, y: b.y, width: b.width, height: b.height,
      ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
      ...(b.hidden === true ? { hidden: true } : {}),
      ...(b.locked === true ? { locked: true } : {}),
      ...(full === undefined || !existsSync(full) ? { missing: true } : {}),
    };
  });
}

/** The project map, with every box on it as a layer. Expects the boxes'
 *  colours already stored (mutate/map.ts `projectMapView`). */
export function mapViewDto(session: ProjectSession | undefined): ProjectMapViewDto {
  const source = session?.loaded.source;
  const empty: ProjectMapViewDto = {
    hasMap: false, groupId: "", groupGameId: "", zones: [], undrawn: [], backgrounds: [], layers: [],
    furniture: { frames: [] }, properties: [],
  };
  if (!source || source.map === undefined) return empty;
  const group = source.map.group;
  const { zones, undrawn } = zoneDtos(group);
  // Checked against the disk here, as the per-box map did, so a view draws a
  // placeholder rather than discovering a 404.
  const backgrounds = backgroundDtos(session!.loaded.dir, group, PROJECT_MAP_ASSETS);
  const layers: ProjectMapLayerDto[] = byDisplay(source.boxes.map((b, i) => ({ b, order: b.box.box.order ?? i })))
    .filter(({ b }) => b.box.box.usesMap === true)
    .map(({ b: box }) => {
      const placed = mapSites(box);
      const { cards } = boxCards(box);
      const sites: ProjectMapSiteDto[] = [];
      const unplaced: ProjectMapLayerDto["unplaced"] = [];
      for (const hand of byDisplay(box.hands.hands)) {
        const at = placed[hand.id];
        const title = hand.title !== undefined ? { title: hand.title } : {};
        if (!at) { unplaced.push({ id: hand.id, gameId: effectiveGameId(hand), ...title }); continue; }
        const template = box.hands.templates.find((t) => t.id === hand.template);
        // A pin's zone comes from the hand's own binding, never from the ground
        // under it: what the runtime deals from is what the map draws.
        const binding = handBinding(hand, template, group.id);
        sites.push({
          id: hand.id, gameId: effectiveGameId(hand), ...title, x: at.x, y: at.y,
          ...(binding.kind !== "none" && binding.tag !== undefined ? { zone: binding.tag } : {}),
          rebinds: binding.editable,
          // The template by its TITLE, as every refusal names a thing.
          ...(binding.kind === "fixed" && template ? { fixedBy: template.title ?? effectiveGameId(template) } : {}),
          // The designer's own word for what this hand is ("Places in the
          // village"): its template's title, under its own on the panel.
          ...(template ? { kind: template.title ?? effectiveGameId(template) } : {}),
          only: tiersAt(session!, box, hand, cards).only.length,
        });
      }
      return {
        box: box.box.box.id, gameId: effectiveGameId(box.box.box),
        ...(box.box.box.title !== undefined ? { title: box.box.box.title } : {}),
        // Stored by ensureBoxColours before this ran, so every layer has one.
        colour: boxColourOf(box) ?? 0,
        sites, unplaced,
        templates: byDisplay(box.hands.templates).map((t) => ({ id: t.id, title: t.title ?? effectiveGameId(t) })),
      };
    });
  return {
    hasMap: true, groupId: group.id, groupGameId: effectiveGameId(group),
    zones, undrawn, backgrounds, layers,
    furniture: { frames: framesOf(source.map).map((r) => ({ ...r })) },
    properties: (group.properties ?? []).map((p) => ({ name: p.name, type: p.type })),
  };
}

/**
 * The map one box shows: the zones of one spatial group, and the box's sites.
 *
 * The map a box shows is the PROJECT map, when the box is on it
 * (design/project-map-contract.md): its zones and pictures once for the
 * project, the box's own sites on them. A box group still marked as a map
 * is a project from before, which the compiler refuses until `format` has
 * moved it; it is still drawn here so the author can see what will move.
 * Nothing here is computed, so the view draws and does not reason.
 */
export function boxMapDto(session: ProjectSession | undefined, boxId: string, groupId?: string): BoxMapDto {
  const base: BoxMapDto = {
    hasProject: session !== undefined,
    groups: [], zones: [], undrawn: [], backgrounds: [], sites: [], unplaced: [],
    furniture: { frames: [] },
  };
  const source = session?.loaded.source;
  const box = source?.boxes.find((b) => b.box.box.id === boxId);
  if (!source || !box) return base;
  const colour = boxColourOf(box);

  const spatial = [
    ...(box.box.box.usesMap === true && source.map !== undefined ? [source.map.group] : []),
    ...box.tags.groups.filter(isSpatial),
  ];
  const groups = spatial.map((g) => ({ id: g.id, gameId: effectiveGameId(g) }));
  // The group asked for, else the box's first: opening the view should show a map
  // rather than ask which one before showing anything.
  const group = spatial.find((g) => g.id === groupId) ?? spatial[0];
  if (!group) return { ...base, groups };

  const { zones, undrawn } = zoneDtos(group);
  const backgrounds = backgroundDtos(session!.loaded.dir, group, box.box.box.id);

  // A pin's ZONE comes from the hand, never from the ground under the pin: the
  // hand's own binding is what the runtime deals from, so it is what the map
  // must draw, and a second copy in the map shard could only go on to disagree.
  const placed = mapSites(box);
  const sites: MapSiteDto[] = [];
  const unplaced: { id: string; gameId: string }[] = [];
  for (const hand of box.hands.hands) {
    const at = placed[hand.id];
    // Titles ride along: a pin and a side-panel row say what the author called
    // the place, and the gameId is the address, not the name (plan item 0).
    const title = hand.title !== undefined ? { title: hand.title } : {};
    if (!at) { unplaced.push({ id: hand.id, gameId: effectiveGameId(hand), ...title }); continue; }
    const template = box.hands.templates.find((t) => t.id === hand.template);
    const binding = handBinding(hand, template, group.id);
    sites.push({
      id: hand.id, gameId: effectiveGameId(hand), ...title, x: at.x, y: at.y,
      ...(binding.kind !== "none" && binding.tag !== undefined ? { zone: binding.tag } : {}),
      ...(colour !== undefined && group === source.map?.group ? { colour } : {}),
      rebinds: binding.editable,
      ...(binding.kind === "fixed" && template ? { fixedBy: template.title ?? effectiveGameId(template) } : {}),
    });
  }

  return {
    hasProject: true, groups, groupId: group.id, zones, undrawn, backgrounds, sites, unplaced,
    furniture: furnitureDto(canvasFurniture(box, { kind: "map" }, source.map)),
  };
}

/** One map, the project's, seen from each box on it, for a surface that offers
 *  a choice of maps (the Board). With more than one box on it they are stamped
 *  as one space, so the Board draws the place ONCE with every box's hands on
 *  it, as it drew shared copies before. */
export function projectMaps(session: ProjectSession | undefined): ProjectMapDto[] {
  const source = session?.loaded.source;
  if (!source || source.map === undefined) return [];
  const group = source.map.group;
  const on = source.boxes.filter((b) => b.box.box.usesMap === true);
  return on.map((box) => ({
    box: box.box.box.id, boxGameId: effectiveGameId(box.box.box),
    group: group.id, groupGameId: effectiveGameId(group),
    ...(on.length > 1 ? { space: 0 } : {}),
  }));
}

/**
 * One zone, for the Map page's side panel: its properties declared once, and
 * what every box on the map has there (its sites, and the cards filed to the
 * zone with no place of their own). Only boxes with something there are
 * listed: "Used by" is a fact about the zone, not a list of the map's boxes.
 */
export function mapZoneDetail(session: ProjectSession, tagId: string): MapZoneDetailDto | null {
  const source = session.loaded.source;
  const group = source?.map?.group;
  const tag = group?.tags.find((t) => t.id === tagId);
  if (!source || !group || !tag) return null;
  const property = (p: PropertyDecl, own: boolean): MapZonePropertyDto => ({
    name: p.name, type: p.type,
    ...(p.values !== undefined ? { values: p.values } : p.stages !== undefined ? { values: p.stages } : {}),
    start: asText(tag.values?.[p.name] ?? p.default),
    ...(p.shared === true ? { shared: true } : {}),
    ...(own ? { own: true } : {}),
  });
  const byBox: MapZoneBoxDto[] = [];
  for (const { b: box } of byDisplay(source.boxes.map((b, i) => ({ b, order: b.box.box.order ?? i })))) {
    if (box.box.box.usesMap !== true) continue;
    const { cards, deckOf } = boxCards(box);
    // A hand bound to this zone, and a MOVING hand (its zone comes from a
    // property) at every zone that property can name: a performer who walks
    // the docks and the market is in both zones' lists, marked as moving, and
    // in neither before this (the antagonist review, round 3, 1.7).
    const sites = byDisplay(box.hands.hands)
      .filter((hand) => tagsOfHand(axisBox(box), hand, group, holeDecls(source, box, hand)).includes(tagId))
      .map((hand) => ({
        id: hand.id, gameId: effectiveGameId(hand), ...(hand.title !== undefined ? { title: hand.title } : {}),
        only: tiersAt(session, box, hand, cards).only.length,
        ...(movesIn(axisBox(box), hand, group.id) ? { moving: true as const } : {}),
      }));
    // Filed to the zone and nowhere narrower: a card with a place is a card for
    // that hand, and is that site's, not the zone's.
    const filed = cards
      .filter((c) => (c.tags?.[PLACE_GROUP] ?? []).length === 0 && (c.tags?.[group.id] ?? []).includes(tagId))
      .map((c): HandCardRef => ({ deck: deckOf.get(c.id)!, card: c.id }));
    if (sites.length === 0 && filed.length === 0) continue;
    byBox.push({
      box: box.box.box.id, gameId: effectiveGameId(box.box.box),
      ...(boxColourOf(box) !== undefined ? { colour: boxColourOf(box)! } : {}),
      ...(box.box.box.title !== undefined ? { title: box.box.box.title } : {}),
      sites, cards: filed,
    });
  }
  return {
    id: tag.id, gameId: effectiveGameId(tag),
    ...(group.purpose !== undefined ? { purpose: group.purpose } : {}),
    properties: [
      ...(group.properties ?? []).map((p) => property(p, false)),
      ...(tag.properties ?? []).map((p) => property(p, true)),
    ],
    byBox,
  };
}
