// ---------------------------------------------------------------------------
// The project map: its zones seen from above, once for the project, with every
// box on the map as a LAYER of its own hands (the surfacing review's plan item
// 2, design/surfacing-review-2026-10/README.md, "Direction: back to basics").
// A pin is where a hand lies on the board laid out; "site" is the format's key
// for that position and never a word on screen (the round-3 ruling: one noun).
//
// An ORDINARY view, and the same gesture grammar as the other two canvases:
// click selects, double-click opens the thing in the editor, right-click offers
// what that thing can do. The map is the tag data you already have
// (design/graphical-views.md section 2): a zone IS a tag of the project map's
// group and its outline lives in that tag; a pin is a hand's position in its
// own box's map shard.
//
// TWO MODES, and the split is the review's. Reading is the common act, so the
// map opens read-only: selecting a site fills the side panel with what can come
// up there, selecting a zone with its properties and everything filed to it,
// and nothing can be dragged. "Edit layout" holds the drawing tools and the
// drag: zones traced and reshaped, pins dropped and dragged (which REBINDS a
// hand, the map's one meaningful move), pictures, frames, comments. A stray
// drag while reading would be a hand moved zone by somebody looking at cards,
// which is the silent edit the 2026-09-07 ruling exists to prevent. The view
// is remounted on the switch (the surface's read-only is a mount option); the
// camera survives through canvas memory.
//
// Zones and sites share ONE surface and one selection, with each item saying
// which it is. Two stacked surfaces would mean two cameras to keep in step and
// two selections to reconcile, for no gain.
//
// This file mounts the canvas and decides what a drop, a delete and a
// right-click MEAN. The side panel is map-side.ts, the tools and the strip
// that offers them map-tools.ts, and the words both say map-words.ts.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { boxColourIndex } from "./box-tint.js";
import { mountCanvasSurface, type CanvasItem, type CanvasSurface, type DrawContext } from "./canvas-surface.js";
import { mapCameraKey, recallCamera, rememberCamera } from "./canvas-memory.js";
import { readCanvasTokens, watchCanvasTokens } from "./canvas-tokens.js";
import {
  backgroundShape, drawBackground, drawSite, drawZone, pinPlacement, sitePoint, siteShape, worldOutline, zoneShape,
  LABEL_FLOOR, type BackgroundShape, type SiteShape, type ZoneShape,
} from "./map-art.js";
import { onImageReady, retryFailedImages } from "./image-cache.js";
import { drawFrame, frameShape, type FrameShape } from "./furniture-art.js";
import { createFurniture, type FurnitureController } from "./furniture-edit.js";
import { handHeat } from "./coverage-art.js";
import { MAP_LAYER_PICTURES, MAP_LAYER_ZONES, activeBox, isShown, orderedBoxes, setActive } from "./map-layers.js";
import { openPictureMenu, restackItems, type Restack } from "./map-menus.js";
import { createMapSide } from "./map-side.js";
import { createMapTools } from "./map-tools.js";
import { fixedDropLine, layerName, mapHoverTip } from "./map-words.js";
import type { Polygon } from "@storylet-studio/model";
import type {
  CanvasFurnitureDto, CommentMarkerDto, CoverageOverlayDto, MapBackgroundDto, MapLayerPrefs,
  ProjectMapLayerDto, ProjectMapSiteDto, ProjectMapViewDto,
} from "../../shared/api.js";
import type Konva from "konva";

export interface MapViewActions {
  /** Double-click a zone: the zone group's page, where every zone's properties
   *  are declared. */
  openZone: (tagId: string) => void;
  /** Double-click a site: the hand's page. */
  openHand: (box: string, handId: string) => void;
  /** A traced outline for a zone that had none. */
  placeZone: (tagId: string, polygon: Polygon) => void;
  /** A traced outline for a zone that does not exist yet: make the tag too. */
  newZone: (polygon: Polygon) => void;
  /** A zone's outline changed: moved, reshaped, a vertex added or removed. An empty
   *  polygon clears it. */
  reshapeZone: (tagId: string, polygon: Polygon) => void;
  /** Import a picture behind the map: opens a picker in main. `place` is the
   *  camera now, so it arrives comfortable to grab at this zoom. */
  addBackground: (place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } }) => void;
  /** One picture changed: moved, scaled, faded, hidden, locked. `coalesce` joins
   *  a continuous gesture into one undo step. */
  editBackground: (
    id: string,
    edit: { x?: number; y?: number; width?: number; height?: number; opacity?: number; hidden?: boolean; locked?: boolean },
    opts?: { coalesce?: boolean },
  ) => void;
  /** A picture moved through the stack, among the other pictures. */
  restackBackground: (id: string, move: Restack) => void;
  /** A picture came off the map. Its file stays and is swept at session end. */
  removeBackground: (id: string) => void;
  /** A zone moved through the stack. Which zone owns a pin is the frontmost one
   *  it stands in, so this can rebind hands where zones overlap. */
  restackZone: (tagId: string, move: Restack) => void;
  /** One box's sites moved or were placed: where each one now is. Which zone
   *  that turns out to be, and therefore which hands are rebound, is decided in
   *  main from the position over the geometry: one rule, one place (main/mutate/map.ts). */
  movedSites: (box: string, moves: { id: string; x: number; y: number }[]) => void;
  /** "+ Hand": a new hand in `box`, pinned here, in one undo step: an
   *  instance of `template` when one was picked, standalone otherwise. */
  newSite: (box: string, at: { x: number; y: number }, template?: string) => void;
  /** Take a hand off the map. The hand itself stays; only its pin goes. */
  removeSite: (box: string, handId: string) => void;
  /** The author picked a colour for a box's layer from its swatch. */
  setColour: (box: string, colour: number) => void;
  /** The furniture changed: the whole list, with the gesture named for undo. */
  setFurniture: (furniture: CanvasFurnitureDto, label: string, coalesce?: string) => void;
  /** The comment markers on this map, as main resolved them. The same four calls
   *  the node view takes: markers are a property of a CANVAS, not of what the
   *  canvas happens to be showing (design/annotation.md 3). */
  markers: () => CommentMarkerDto[];
  /** The coverage overlay, or undefined when it is off (see node-view). */
  coverage: () => CoverageOverlayDto | undefined;
  /** Whether the overlay is ON, which is not the same as having a report. */
  coverageOn: () => boolean;
  openThread: (threadId: string, anchor: HTMLElement) => void;
  startThread: (
    at: { x: number; y: number }, item: string | undefined, anchor: HTMLElement,
  ) => void;
  moveMarker: (threadId: string, x: number, y: number, item?: string) => void;
  /** This person's layers (app state). */
  layers: () => MapLayerPrefs;
  /** Keep a change to the layers. The view repaints itself; this persists. */
  setLayers: (prefs: MapLayerPrefs) => void;
  /** Into Edit layout, or out: the renderer remounts the view in that mode. */
  setEditing: (on: boolean) => void;
  /** Fill the side panel with one SITE: what can come up there. `back`
   *  returns the panel to the layer list. */
  paintSite: (host: HTMLElement, layer: ProjectMapLayerDto, site: ProjectMapSiteDto, back: () => void) => void;
  /** Fill the side panel with one ZONE: its properties, sites and cards by
   *  box. `hidden` is the box layers hidden now, whose share the panel folds
   *  into one line; `show` brings those layers back. */
  paintZone: (host: HTMLElement, tagId: string, hidden: Set<string>, show: (boxes: string[]) => void, back: () => void) => void;
}

export interface MountedMapView {
  /** Hands whose zone changed because of an edit here: main's answer to a site
   *  drop. `zone` null means the hand now sits in none, which the Problems bar
   *  will be naming as an error. */
  rebound: (changes: { id: string; zone: string | null }[]) => void;
  /** Open one marker's thread, centring the canvas on it: the feedback walk's
   *  way in. False when that thread is not a marker on this canvas. */
  openMarker: (threadId: string) => boolean;
  /** Redraw the comment markers alone. Not a remount: that would lose the camera
   *  and the selection. */
  repaintMarkers: () => void;
  /** The overlay came, went or was re-run (see node-view). */
  refreshCoverage: () => void;
  /** Select an item and bring it into view: a way back to the map that should
   *  land on the site it left from. */
  select: (id: string) => void;
  destroy: () => void;
}

/** One item on the map. Zones and sites share a surface, so each says which it is. */
export type MapItem =
  | (BackgroundShape & { kind: "background" })
  | FrameShape
  | (ZoneShape & { kind: "zone" })
  | (SiteShape & { kind: "site"; box: string })

export function mountMapView(
  host: HTMLElement, map: ProjectMapViewDto, editing: boolean, actions: MapViewActions,
): MountedMapView {
  const stage = el("div", { className: "nodestage" });
  const strip = el("div", { className: "nodestrip" });
  // The canvas takes the big column and a side panel carries the CONTENTS: the
  // layers, or the thing selected (map-side.ts).
  const side = el("aside", { className: "mapside wide" });
  const main = el("div", { className: "mapmain-ed" }, stage, strip);
  host.replaceChildren(el("div", { className: "mapwrap" }, main, side));

  const boxIds = map.layers.map((l) => l.box);
  const layerOf = new Map(map.layers.map((l) => [l.box, l]));
  const siteDto = new Map(map.layers.flatMap((l) => l.sites.map((s) => [s.id, s] as const)));
  /** What each pin's hand can do about its binding: whether dragging it means
   *  anything, and if not, why not. */
  const siteRule = new Map(map.layers.flatMap((l) => l.sites.map((p) => [p.id, { rebinds: p.rebinds, fixedBy: p.fixedBy }] as const)));
  let prefs = actions.layers();
  const keep = (next: MapLayerPrefs): void => {
    prefs = next;
    actions.setLayers(next);
    rebuild();
  };

  /** A zone's name from its id. Undrawn zones count: a hand can be bound to a
   *  zone nobody has traced yet, and the map should not be coy about its name. */
  const zoneName = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return map.zones.find((z) => z.id === id)?.gameId ?? map.undrawn.find((z) => z.id === id)?.gameId;
  };

  /**
   * Put a pin's placement on it (map-art `pinPlacement`), after it was built,
   * moved, or its hand was rebound: the other zones it also falls inside, and
   * whether it stands off the zone its hand is bound to.
   *
   * Overlapping outlines are legitimate (a market square inside a district) and
   * the model resolves a point to the frontmost: that is `zoneAt`, and it is what
   * a DRAG binds to. What the picture cannot say is that the other outlines count
   * for nothing, so the pin is marked and the strip explains. A pin's zone comes
   * from its hand's binding, not from geometry, so the two can disagree, and
   * when they do the pin wears a warning ring.
   */
  const replace = (item: SiteShape): void => {
    const p = pinPlacement(sitePoint(item), item.zone, map.zones, zoneName);
    if (p.alsoInside !== undefined) item.alsoInside = p.alsoInside; else delete item.alsoInside;
    if (p.strayFrom !== undefined) item.strayFrom = p.strayFrom; else delete item.strayFrom;
  };

  // --- the items, filtered by the layers --------------------------------------
  let items: MapItem[] = [];
  function buildItems(): MapItem[] {
    const sitesOf = (layer: ProjectMapLayerDto): MapItem[] => layer.sites.map((site): MapItem => ({
      kind: "site", box: layer.box,
      ...siteShape({
        id: site.id, title: site.title ?? site.gameId, name: site.gameId, at: { x: site.x, y: site.y },
        ...(site.zone !== undefined
          ? { zone: site.zone, ...(zoneName(site.zone) !== undefined ? { zoneName: zoneName(site.zone)! } : {}) }
          : {}),
      }),
      // Tinted by BOX: on the project map the first thing a pin answers is
      // whose it is (map-art.ts, `tint`), in the box's stored colour.
      tint: boxColourIndex(layer.box),
    })).map((item) => { replace(item as SiteShape); return item; });
    // Box layers bottom first, so the TOP layer's pins draw last, over the rest:
    // the layer order is the pin draw order.
    const shownBoxes = orderedBoxes(prefs, boxIds).filter((b) => isShown(prefs, b)).reverse();
    return [
      // Pictures FIRST, so they are a band structurally below every zone: no z
      // value can put an image over a zone, because the bands are the array
      // order. A hidden one (its own flag, the project's) is not built at all.
      ...(isShown(prefs, MAP_LAYER_PICTURES)
        ? map.backgrounds.filter((b) => b.hidden !== true).map((b): MapItem => ({ kind: "background", ...backgroundShape(b) }))
        : []),
      // Frames above the pictures and below the zones: furniture describes the
      // map, so it sits on the base and under the thing it describes.
      ...map.furniture.frames.map((r): MapItem => frameShape(r)),
      ...(isShown(prefs, MAP_LAYER_ZONES)
        ? map.zones.map((zone): MapItem => ({
          kind: "zone",
          ...zoneShape({ id: zone.id, title: zone.gameId, name: zone.gameId, polygon: zone.polygon }),
        }))
        : []),
      ...shownBoxes.flatMap((b) => sitesOf(layerOf.get(b)!)),
    ];
  }

  /**
   * Put the coverage reading on the sites. After `siteShape` rather than
   * through it: heat is a mode that comes and goes over a canvas that stays up.
   */
  const dressCoverage = (): void => {
    const cover = actions.coverage();
    for (const item of items) {
      if (item.kind !== "site") continue;
      // A site IS a hand on the map, so the hand's heat is the site's.
      item.heat = cover === undefined ? undefined : handHeat(item.id, cover);
    }
  };

  const cameraKey = mapCameraKey("project", map.groupId);
  const byId = (id: string): MapItem | undefined => items.find((i) => i.id === id);
  /** Why the last drop did not rebind, when there is something to say. */
  let refused: string | undefined;
  let tokens = readCanvasTokens();
  /** Built after the surface, which it draws on. */
  let furniture: FurnitureController | undefined;
  /** A picture's menu, open at a point on screen: from its row in the panel,
   *  or from a right-click on the canvas. */
  const pictureMenu = (b: MapBackgroundDto, at: { x: number; y: number }): void =>
    openPictureMenu(b, map.backgrounds.map((x) => x.id), actions, at);

  // The panel and the tools are built BEFORE the surface, whose callbacks use
  // them, and reach it through a getter: none of them asks for it until it is
  // mounted below.
  const sidePanel = createMapSide({
    side, map, editing, boxIds, layerOf, siteDto,
    prefs: () => prefs, keep, zoneName,
    surface: () => surface, byId,
    busy: () => tools.busy(),
    trace: (zone, label) => tools.trace(zone, label),
    place: (box, handId, label) => tools.place(box, handId, label),
    pictureMenu, actions,
  });
  /** The side panel, then the strip: what every change of tool or selection
   *  repaints outside the canvas. */
  const refresh = (): void => { sidePanel.paint(); tools.paintStrip(); };
  const tools = createMapTools({
    stage, strip, map, editing, boxIds, layerOf, siteRule,
    surface: () => surface, items: () => items, byId, zoneName,
    prefs: () => prefs, keep, tokens: () => tokens,
    furniture: () => furniture, refused: () => refused, refresh, actions,
  });

  /** Take one thing off the map, the way its menu's "Remove from the map" does:
   *  a pin's hand stays, a zone's tag stays, a picture's file stays. */
  function removeFromMap(id: string): void {
    const item = byId(id);
    if (item?.kind === "site") actions.removeSite(item.box, item.id);
    else if (item?.kind === "zone") actions.reshapeZone(item.id, []);
    else if (item?.kind === "background") actions.removeBackground(item.id);
  }

  // --- the canvas --------------------------------------------------------------
  const surface: CanvasSurface<MapItem> = mountCanvasSurface<MapItem>({
    host: stage,
    tokens,
    // A map is a place, not a diagram: nothing snaps.
    grid: 0,
    // Reading moves nothing (see the header): the drag is Edit layout's.
    readOnly: !editing,
    draw: (item: MapItem, ctx: DrawContext): Konva.Group => {
      if (item.kind === "background") return drawBackground(item, ctx);
      if (item.kind === "frame") return drawFrame(item, ctx);
      return item.kind === "zone" ? drawZone(item, ctx) : drawSite(item, ctx);
    },
    hoverTip: (item, scale) => mapHoverTip(item, scale, {
      zoneName,
      boxName: (box) => { const layer = layerOf.get(box); return layer && layerName(layer); },
      manyBoxes: map.layers.length > 1,
    }),
    onActivate: (id) => {
      if (furniture?.activate(id) === true) return;
      const item = byId(id);
      if (item?.kind === "zone") actions.openZone(id);
      else if (item?.kind === "site") actions.openHand(item.box, id);
    },
    onSelectionChange: () => {
      tools.unpick();
      // Selecting a pin makes its box the active layer: the next "+ Hand" goes
      // where the author was just looking.
      const chosen = surface.selection();
      const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;
      if (only?.kind === "site" && activeBox(prefs, boxIds) !== only.box) {
        prefs = setActive(prefs, only.box);
        actions.setLayers(prefs);
      }
      tools.repaint();
      refresh();
    },
    // "Delete means delete": in Edit layout, Delete takes the selection off the
    // map exactly as each thing's menu does (the October 2026 review), with a
    // picked corner the one exception, since a corner is what is selected then.
    // Reading moves and removes nothing.
    onDelete: () => {
      if (!editing) return;
      const chosen = surface.selection();
      const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;
      const picked = tools.pickedVertex();
      if (picked !== undefined && only?.kind === "zone") { tools.removeVertex(only.id, picked); return; }
      const rest = furniture?.absorbDelete(chosen) ?? chosen;
      for (const id of rest) removeFromMap(id);
    },
    onContext: (id, _world, e) => {
      if (id !== undefined && editing && furniture?.menu(id, e) === true) return;
      const item = id === undefined ? undefined : byId(id);
      // Per-item actions only. The wording names what goes and what stays;
      // nothing here ever deletes a tag or a hand. Reading offers the way in;
      // the layout verbs are Edit layout's.
      if (item?.kind === "site") {
        openContextMenu(e.clientX, e.clientY, [
          { label: `Open ${item.title}`, onClick: () => actions.openHand(item.box, item.id) },
          ...(editing ? [{ label: "Remove from the map", danger: true, onClick: () => removeFromMap(item.id) }] : []),
        ]);
        return;
      }
      if (item?.kind === "background" && editing) {
        const dto = map.backgrounds.find((b) => b.id === item.id);
        if (dto) pictureMenu(dto, { x: e.clientX, y: e.clientY });
        return;
      }
      if (item?.kind === "zone") {
        openContextMenu(e.clientX, e.clientY, [
          { label: `Open ${item.title}`, onClick: () => actions.openZone(item.id) },
          ...(editing ? restackItems(map.zones.map((z) => z.id), item.id, (to) => actions.restackZone(item.id, to)) : []),
          ...(editing ? [{ label: "Remove from the map", danger: true, onClick: () => removeFromMap(item.id) }] : []),
        ]);
      }
    },
    onMove: (rawMoves) => {
      // Furniture first, and it takes its own out of the list.
      const moves = furniture?.absorbMoves(rawMoves) ?? rawMoves;
      for (const move of moves) {
        const item = byId(move.id);
        if (item) { item.x = move.x; item.y = move.y; }
      }
      // A dropped ZONE writes its new outline. It rebinds nobody (see the
      // tools' `applyOutline`).
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind === "zone") {
          const polygon = worldOutline(item);
          const dto = map.zones.find((z) => z.id === item.id);
          if (dto) dto.polygon = polygon;
          actions.reshapeZone(item.id, polygon);
        }
      }
      // A dropped PICTURE keeps its new corner, coalesced: one gesture. Into the
      // map's own copy too, which the next rebuild (a layer control) reads.
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind !== "background") continue;
        tools.applyPicture(item.id, { x: move.x, y: move.y });
        actions.editBackground(item.id, { x: move.x, y: move.y }, { coalesce: true });
      }
      // Then the PINS, the move the map exists for, PER BOX: a box's sites are
      // its own shard. Main works out which zone each landed in and which hands
      // it rebinds, and says so through `rebound`.
      const dropped = moves
        .map((m) => byId(m.id))
        .filter((i): i is SiteShape & { kind: "site"; box: string } => i?.kind === "site");
      if (dropped.length > 0) {
        refused = undefined;
        for (const site of dropped) {
          const rule = siteRule.get(site.id);
          if (rule?.fixedBy !== undefined) refused = fixedDropLine(site.title, rule.fixedBy);
          const dto = siteDto.get(site.id);
          if (dto) { const at = sitePoint(site); dto.x = at.x; dto.y = at.y; }
          replace(site);
        }
        const byBox = new Map<string, { id: string; x: number; y: number }[]>();
        for (const site of dropped) {
          const list = byBox.get(site.box) ?? [];
          list.push({ id: site.id, ...sitePoint(site) });
          byBox.set(site.box, list);
        }
        for (const [box, list] of byBox) actions.movedSites(box, list);
      }
      surface.setItems(items);
      tools.repaint();
      refresh();
    },
    onCamera: () => { rememberCamera(cameraKey, surface.camera()); },
  });

  furniture = createFurniture({
    surface: () => surface as unknown as CanvasSurface<CanvasItem>,
    container: () => stage,
    get: () => map.furniture,
    save: (next, label, coalesce) => actions.setFurniture(next, label, coalesce),
    repaint: () => { tools.repaint(); refresh(); },
    // Reading renames nothing: a double-click on a frame there is not an edit.
    readOnly: () => !editing,
  });
  tools.attach();

  /** The layers changed: rebuild what is drawn, keep the camera and whatever of
   *  the selection is still on the map. */
  function rebuild(): void {
    items = buildItems();
    dressCoverage();
    const still = surface.selection().filter((id) => items.some((i) => i.id === id));
    surface.setItems(items);
    if (still.length !== surface.selection().length) surface.select(still);
    sidePanel.forget();
    tools.repaint();
    refresh();
  }

  // A picture that would not load last time is looked for again: it may have
  // been copied in since, or its drive mounted.
  retryFailedImages();
  items = buildItems();
  dressCoverage();
  surface.setItems(items);
  tools.repaint();
  const remembered = recallCamera(cameraKey);
  // First visit: open where the hands' names show (canvas-surface `fitReadable`).
  if (remembered) surface.setCamera(remembered);
  else surface.fitReadable(LABEL_FLOOR, () => items.filter((i) => i.kind === "site"));
  refresh();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); tools.repaint(); });
  // A picture finishing its load is the one repaint nobody asked for.
  const unwatchImages = onImageReady(() => { surface.setItems(items); tools.repaint(); });

  return {
    repaintMarkers() { surface.repaintMarkers(); },
    openMarker: (threadId) => tools.openMarker(threadId),
    refreshCoverage() { dressCoverage(); surface.setItems(items); refresh(); },
    select(id) {
      if (!items.some((i) => i.id === id)) return;
      surface.select([id]);
      surface.revealIfOffscreen([id]);
    },
    rebound(changes) {
      if (changes.length === 0) return;
      for (const change of changes) {
        const site = byId(change.id);
        const dto = siteDto.get(change.id);
        if (dto) { if (change.zone === null) delete dto.zone; else dto.zone = change.zone; }
        if (site?.kind !== "site") continue;
        site.zone = change.zone ?? undefined;
        site.zoneName = change.zone === null ? undefined : zoneName(change.zone);
        site.unbound = change.zone === null;
        replace(site);
      }
      surface.setItems(items);
      sidePanel.forget();
      tools.repaint();
      refresh();
    },
    destroy() {
      rememberCamera(cameraKey, surface.camera());
      // A frame name being typed is kept, and its editor goes with the view.
      furniture?.destroy();
      unwatchImages();
      unwatch();
      surface.destroy();
    },
  };
}

/** The box a hand belongs to on the map, placed or waiting. */
export const siteBoxOf = (map: ProjectMapViewDto, handId: string): string | undefined =>
  map.layers.find((l) => l.sites.some((s) => s.id === handId) || l.unplaced.some((u) => u.id === handId))?.box;
