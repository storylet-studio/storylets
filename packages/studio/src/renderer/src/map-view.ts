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
// ADDING is a control, not a menu: the strip carries the verbs, and the side
// panel the things waiting to be placed.
//
// A zone is TRACED, never conjured as a square. Click to lay vertices, click the
// first one again or press Enter to close, Escape to abandon; then drag its
// vertices to reshape, or a mid-edge handle to add one. That is the old
// system's canvas (../storylets-old, StorymapCanvasZoneHandles and its
// draw-zone tool), whose conventions were paid for once already.
//
// Zones and sites share ONE surface and one selection, with each item saying
// which it is. Two stacked surfaces would mean two cameras to keep in step and
// two selections to reconcile, for no gain.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { iconNode, openAnchoredPanel, plural, tipWithKey, wireReorder } from "@wildwinter/app-shell";
import { boxColour, boxColourIndex, boxPin } from "./box-tint.js";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { mountCanvasSurface, type CanvasItem, type CanvasSurface, type DrawContext } from "./canvas-surface.js";
import { mapCameraKey, recallCamera, rememberCamera } from "./canvas-memory.js";
import { readCanvasTokens, watchCanvasTokens } from "./canvas-tokens.js";
import {
  backgroundShape, drawBackground, drawSite, drawZone, paintZoneLabels, pinPlacement, sitePoint, siteShape, zoneShape,
  LABEL_FLOOR, type BackgroundShape, type SiteShape, type ZoneShape,
} from "./map-art.js";
import { onImageReady } from "./image-cache.js";
import { drawFrame, frameShape, type FrameShape } from "./furniture-art.js";
import { createFurniture, type FurnitureController } from "./furniture-edit.js";
import { markerPainter, markerPoint } from "./comment-markers.js";
import { coverageLegend, handHeat } from "./coverage-art.js";
import {
  closesShape, paintDraft, paintHandles, paintScaleHandles, withVertexAfter, withVertexAt, withoutVertex,
} from "./map-edit.js";
import {
  MAP_LAYER_PICTURES, MAP_LAYER_ZONES, activeBox, hideAll, isShown, moveLayer, orderedBoxes, setActive,
  showAll, showLayer, soloLayer, toggleLayer,
} from "./map-layers.js";
import { mapGlyph } from "./map-glyphs.js";
import type { Polygon, ViewPoint } from "@storylet-studio/model";
import type {
  CanvasFurnitureDto, CommentMarkerDto, CoverageOverlayDto, MapBackgroundDto, MapLayerPrefs,
  ProjectMapLayerDto, ProjectMapSiteDto, ProjectMapViewDto,
} from "../../shared/api.js";
import Konva from "konva";

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
  restackBackground: (id: string, move: "front" | "forward" | "backward" | "back") => void;
  /** A picture came off the map. Its file stays and is swept at session end. */
  removeBackground: (id: string) => void;
  /** A zone moved through the stack. Which zone owns a pin is the frontmost one
   *  it stands in, so this can rebind hands where zones overlap. */
  restackZone: (tagId: string, move: "front" | "forward" | "backward" | "back") => void;
  /** One box's sites moved or were placed: where each one now is. Which zone
   *  that turns out to be, and therefore which hands are rebound, is decided in
   *  main from the position over the geometry: one rule, one place (mutate.ts). */
  movedSites: (box: string, moves: { id: string; x: number; y: number }[]) => void;
  /** "+ Hand": a new hand in `box`, pinned here, in one undo step. */
  newSite: (box: string, at: { x: number; y: number }) => void;
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
type MapItem =
  | (BackgroundShape & { kind: "background" })
  | FrameShape
  | (ZoneShape & { kind: "zone" })
  | (SiteShape & { kind: "site"; box: string })

/** A box's name as a person reads it. */
const layerName = (l: { title?: string; gameId: string }): string => l.title ?? l.gameId;

export function mountMapView(
  host: HTMLElement, map: ProjectMapViewDto, editing: boolean, actions: MapViewActions,
): MountedMapView {
  const stage = el("div", { className: "nodestage" });
  const strip = el("div", { className: "nodestrip" });
  // The canvas takes the big column and a side panel carries the CONTENTS: the
  // layers, or the thing selected. A map is wide and shallow, so the room to
  // spend is on the right, which is also the Board's own map shape.
  const side = el("aside", { className: "mapside wide" });
  const main = el("div", { className: "mapmain-ed" }, stage, strip);
  host.replaceChildren(el("div", { className: "mapwrap" }, main, side));

  const boxIds = map.layers.map((l) => l.box);
  const layerOf = new Map(map.layers.map((l) => [l.box, l]));
  /** Which box each site belongs to: a hand id is unique project-wide. */
  const siteBox = new Map(map.layers.flatMap((l) => l.sites.map((s) => [s.id, l.box] as const)));
  const siteDto = new Map(map.layers.flatMap((l) => l.sites.map((s) => [s.id, s] as const)));
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
   * What a pin's position says about its hand (map-art `pinPlacement`): the
   * other zones it also falls inside, and whether it stands off the zone its
   * hand is bound to.
   *
   * Overlapping outlines are legitimate (a market square inside a district) and
   * the model resolves a point to the frontmost: that is `zoneAt`, and it is what
   * a DRAG binds to. What the picture cannot say is that the other outlines count
   * for nothing, so the pin is marked and the strip explains. A pin's zone comes
   * from its hand's binding, not from geometry, so the two can disagree, and
   * when they do the pin wears a warning ring.
   */
  const placeOf = (item: { x: number; y: number; width: number; height: number; zone?: string }): { alsoInside?: string[]; strayFrom?: string } =>
    pinPlacement({ x: item.x + item.width / 2, y: item.y + item.height / 2 }, item.zone, map.zones, zoneName);
  /** Put a pin's placement on it, after it moved or its hand was rebound. */
  const replace = (item: SiteShape): void => {
    const p = placeOf(item);
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

  /** What each pin's hand can do about its binding: whether dragging it means
   *  anything, and if not, why not. */
  const siteRule = new Map(map.layers.flatMap((l) => l.sites.map((p) => [p.id, { rebinds: p.rebinds, fixedBy: p.fixedBy }] as const)));

  const byId = (id: string): MapItem | undefined => items.find((i) => i.id === id);
  let furniture: FurnitureController | undefined;
  /** The comment tool is armed: the next click drops a marker. */
  let commentArmed = false;
  const worldOutline = (z: ZoneShape): Polygon => z.outline.map((p) => ({ x: z.x + p.x, y: z.y + p.y }));
  // --- what is being traced or placed -----------------------------------------
  let busy: { label: string; tag?: string; drawing: boolean } | undefined;
  let draft: Polygon = [];
  let pointer: ViewPoint | undefined;
  let preview: { id: string; polygon: Polygon } | undefined;
  let pickedVertex: number | undefined;
  /** Why the last drop did not rebind, when there is something to say. */
  let refused: string | undefined;
  let scaling: { id: string; rect: { x: number; y: number; width: number; height: number } } | undefined;

  /**
   * A zone's new outline: applied HERE first, then persisted. The canvas holds
   * its own copy of every shape, so persisting alone left the picture as it was:
   * an inserted corner appeared for one frame and vanished on the next repaint.
   *
   * Nothing is rebound here, and that is the point (2026-08-06): a hand's zone is
   * the hand's own binding, changed only by dragging that hand's pin.
   */
  function applyOutline(zoneId: string, polygon: Polygon): void {
    const at = items.findIndex((i) => i.id === zoneId);
    const zone = at >= 0 ? items[at] : undefined;
    if (!zone || zone.kind !== "zone") return;
    items[at] = { kind: "zone", ...zoneShape({ id: zoneId, title: zone.title, name: zone.name, polygon }) };
    const dto = map.zones.find((z) => z.id === zoneId);
    if (dto) dto.polygon = polygon;
    preview = undefined;
    surface.setItems(items);
    repaint();
    paintStrip();
    actions.reshapeZone(zoneId, polygon);
  }

  function stopTool(): void {
    busy = undefined;
    draft = [];
    pointer = undefined;
    surface.setTool(undefined);
    repaint();
    paintStrip();
  }

  /** Trace an outline: for an existing undrawn zone, or for one not yet declared. */
  function trace(tag: string | undefined, label: string): void {
    busy = { label, drawing: true, ...(tag !== undefined ? { tag } : {}) };
    draft = [];
    pointer = undefined;
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        if (closesShape(draft, at, surface.scale())) { finishTrace(); return; }
        draft = [...draft, { x: Math.round(at.x), y: Math.round(at.y) }];
        repaint();
        paintStrip();
      },
      onMove: (at) => { pointer = at; repaint(); },
      onCommit: () => finishTrace(),
      onCancel: () => stopTool(),
    });
    repaint();
    paintStrip();
  }

  function finishTrace(): void {
    // Under three points there is no shape: an abandon rather than a save.
    if (draft.length < 3) { stopTool(); return; }
    const shape = draft;
    const tag = busy?.tag;
    stopTool();
    if (tag !== undefined) actions.placeZone(tag, shape);
    else actions.newZone(shape);
  }

  /** Place a hand that has no pin yet: the next click drops it, wherever that is. */
  function place(box: string, handId: string, label: string): void {
    busy = { label, drawing: false };
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        // A tool takes over the click so a pin can be dropped INSIDE a zone;
        // landing in one is what binds the hand.
        stopTool();
        actions.movedSites(box, [{ id: handId, x: Math.round(at.x), y: Math.round(at.y) }]);
      },
      onCancel: () => stopTool(),
    });
    paintStrip();
  }

  /** "+ Hand": a new hand in the ACTIVE layer's box, made where the click lands. */
  function newSite(): void {
    const box = activeBox(prefs, boxIds);
    if (box === undefined) return;
    busy = { label: `a new hand for ${layerName(layerOf.get(box)!)}`, drawing: false };
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        stopTool();
        // Into a hidden layer, the layer is shown: the new hand appears where
        // it was put, rather than being made out of sight.
        if (!isShown(prefs, box)) keep(showLayer(prefs, box));
        actions.newSite(box, { x: Math.round(at.x), y: Math.round(at.y) });
      },
      onCancel: () => stopTool(),
    });
    paintStrip();
  }

  // --- the side panel ------------------------------------------------------------

  /** The layer list's eye: click toggles, Option-click solos (and restores). */
  function eye(layer: string, label: string): HTMLElement {
    const shown = isShown(prefs, layer);
    const b = el("button", {
      className: `maplayer-eye${shown ? "" : " off"}`,
      tip: `${shown ? "Hide" : "Show"} ${label}. Option-click shows only this layer, and again puts the rest back.`,
    }, mapGlyph(shown ? "eye" : "eyeOff", 14, "map-glyph"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      keep(e.altKey ? soloLayer(prefs, layer, boxIds) : toggleLayer(prefs, layer));
    });
    return b;
  }

  /**
   * The side panel with nothing selected: the LAYERS (the author's layered map
   * view). Show all / Hide all at the top, a row per box on the map in the
   * person's order (the active one highlighted), then Zones and Pictures.
   *
   * In Edit layout each layer opens out to its contents, which is what the old
   * Zones / Hands / Pictures panel held: the active box's sites and its hands
   * still waiting to be placed, every zone (an undrawn one arms its trace), and
   * every picture (a picture's row is the only handle a LOCKED picture has).
   */
  function paintLayers(): void {
    const active = activeBox(prefs, boxIds);
    const head = el("div", { className: "maplayers-head" },
      el("span", { className: "mapside-title", text: "Layers" }),
      el("span", { className: "crumb-spacer" }),
      el("button", { className: "maplayers-all", text: "Show all", onClick: () => keep(showAll(prefs)) }),
      el("button", { className: "maplayers-all", text: "Hide all", tip: "Hide every box's hands. Zones stay.", onClick: () => keep(hideAll(prefs, boxIds)) }));
    const rows: HTMLElement[] = [];
    for (const box of orderedBoxes(prefs, boxIds)) {
      const layer = layerOf.get(box)!;
      const swatch = colourSwatch(layer);
      const row = el("div", {
        className: `maplayer${box === active ? " active" : ""}${isShown(prefs, box) ? "" : " hidden"}`,
        tip: box === active ? "The active layer: + Hand adds here." : "Make this the active layer",
      }, eye(box, layerName(layer)), el("span", { className: "maplayer-grip" }, iconNode("grip", 12)), swatch,
        el("span", { className: "maplayer-name", text: layerName(layer) }),
        el("span", { className: "maplayer-n", text: plural(layer.sites.length, "hand") }));
      row.addEventListener("click", () => keep(setActive(prefs, box)));
      // The person's order, by drag: the pin draw order follows it.
      wireReorder(row, box, "y", (from, before, to) => keep(moveLayer(prefs, boxIds, from, to, before)));
      rows.push(row);
      if (editing && box === active) rows.push(...activeContents(layer));
    }
    const zonesRow = el("div", { className: `maplayer${isShown(prefs, MAP_LAYER_ZONES) ? "" : " hidden"}` },
      eye(MAP_LAYER_ZONES, "the zones"), el("span", { className: "maplayer-grip none" }), el("i", { className: "maplayer-swatch zones" }),
      el("span", { className: "maplayer-name", text: "Zones" }),
      el("span", { className: "maplayer-n", text: plural(map.zones.length + map.undrawn.length, "zone") }));
    const picturesRow = el("div", { className: `maplayer${isShown(prefs, MAP_LAYER_PICTURES) ? "" : " hidden"}` },
      eye(MAP_LAYER_PICTURES, "the pictures"), el("span", { className: "maplayer-grip none" }), el("i", { className: "maplayer-swatch pictures" }),
      el("span", { className: "maplayer-name", text: "Pictures" }),
      el("span", { className: "maplayer-n", text: String(map.backgrounds.length) }));
    side.replaceChildren(head, ...rows, zonesRow, ...(editing ? zoneContents() : []),
      picturesRow, ...(editing ? pictureContents() : []),
      ...(editing
        ? []
        : [el("p", { className: "mapside-teach", text: boxIds.length > 0
            ? "Choose a hand to see what can come up there, or a zone for its properties and everything filed to it."
            : "No box uses the map yet. A box joins it from its own page." })]));
  }

  const subRow = (label: string, tip: string, onClick: (e: MouseEvent) => void, cls = "", meta?: string): HTMLElement =>
    el("button", { className: `mapside-row sub${cls}`, tip, onClick },
      el("span", { className: "mapside-name", text: label }),
      ...(meta !== undefined ? [el("span", { className: "mapside-meta", text: meta })] : []));

  /**
   * A layer's colour, as a swatch that changes it: the box's STORED colour
   * (box-tint.ts), picked from the identity palette in an anchored panel, the
   * app's one-choice picker (the deck picker's shape, inspector.ts). Patterpad
   * picks a writing status's colour the same way, a swatch that opens the
   * twelve slots. A slot another layer already wears says so, and can still be
   * chosen: the colours are the author's.
   */
  function colourSwatch(layer: ProjectMapLayerDto): HTMLElement {
    const swatch = el("button", { className: "maplayer-swatch pick", tip: `${layerName(layer)}'s colour. Click to change it.` });
    swatch.style.background = boxColour(layer.box);
    swatch.setAttribute("aria-label", `${layerName(layer)}'s colour`);
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = openAnchoredPanel({ anchor: swatch, className: "swatchpick", title: `${layerName(layer)}'s colour`, width: 196, prefer: "below" });
      if (!panel) return;
      const grid = el("div", { className: "swatchpick-grid" });
      const now = boxColourIndex(layer.box);
      let focus: HTMLElement | undefined;
      for (let slot = 0; slot < 12; slot++) {
        const wearing = map.layers.filter((l) => l.box !== layer.box && boxColourIndex(l.box) === slot).map(layerName);
        const opt = el("button", {
          className: `swatchpick-opt${slot === now ? " sel" : ""}${wearing.length > 0 ? " taken" : ""}`,
          tip: wearing.length > 0 ? `Colour ${slot + 1}, which ${wearing.join(" and ")} ${wearing.length === 1 ? "wears" : "wear"}` : `Colour ${slot + 1}`,
          onClick: () => { panel.close(); if (slot !== now) actions.setColour(layer.box, slot); },
        });
        opt.style.background = `var(--char-${slot})`;
        opt.setAttribute("aria-label", `Colour ${slot + 1}`);
        if (slot === now) focus = opt;
        grid.append(opt);
      }
      panel.body.append(grid);
      focus?.focus();
    });
    return swatch;
  }

  /** The active layer's pinned hands and its hands still waiting for a pin. */
  function activeContents(layer: ProjectMapLayerDto): HTMLElement[] {
    return [
      ...layer.sites.map((site) => {
        const r = subRow(site.title ?? site.gameId, "Show its pin on the map",
          () => { surface.select([site.id]); surface.showSelection(); }, site.title !== undefined ? " titled" : "",
          zoneName(site.zone) ?? "no zone");
        r.prepend(boxPin(layer.box));
        return r;
      }),
      ...layer.unplaced.map((hand) => {
        const r = subRow(hand.title ?? hand.gameId, "Not on the map yet. Click, then click where it sits.",
          () => place(layer.box, hand.id, hand.title ?? hand.gameId), hand.title !== undefined ? " todo titled" : " todo");
        r.append(el("span", { className: "mapside-act", text: "place" }));
        return r;
      }),
    ];
  }

  function zoneContents(): HTMLElement[] {
    const rows = [
      ...map.zones.map((z) => {
        const r = subRow(z.gameId, "Show it on the map", () => { surface.select([z.id]); surface.showSelection(); });
        // Neutral, as the zone is on the map: zones are the project's, and only
        // pins wear a box's colour.
        r.prepend(el("i", { className: "mapside-dot zone" }));
        return r;
      }),
      ...map.undrawn.map((z) => {
        const r = subRow(z.gameId, "Not drawn yet. Click to trace its outline.", () => trace(z.id, z.gameId), " todo");
        r.append(el("span", { className: "mapside-act", text: "trace" }));
        return r;
      }),
    ];
    // What every zone carries, said once: the declarations are the group's.
    if (map.properties.length > 0) {
      rows.push(el("p", { className: "mapside-note",
        text: `Each zone has ${map.properties.map((p) => `${p.name}, ${/^[aeiou]/i.test(p.type) ? "an" : "a"} ${p.type}`).join("; ")}.` }));
    }
    return rows;
  }

  function pictureContents(): HTMLElement[] {
    return map.backgrounds.map((b) =>
      subRow(b.file, "Everything a picture can do, in its menu.",
        (e) => {
          const at = (e.currentTarget as HTMLElement).getBoundingClientRect();
          backgroundMenu(b, { x: at.left, y: at.bottom + 2 });
        }, "", [b.locked === true ? "locked" : "", b.hidden === true ? "hidden" : ""].filter((x) => x !== "").join(", ") || undefined));
  }

  /** Which panel is up, so a repaint of the same selection does not refetch it. */
  let panelFor: string | undefined;
  /** The panel: the selected hand or zone while reading, else the layers. Edit
   *  layout keeps the layers up whatever is selected: the content panel is for
   *  reading, and editing wants the contents to hand. */
  function paintSide(): void {
    const chosen = surface.selection();
    const only = !editing && busy === undefined && chosen.length === 1 ? byId(chosen[0]!) : undefined;
    const back = (): void => { surface.select([]); };
    if (only?.kind === "site") {
      if (panelFor === only.id) return;
      panelFor = only.id;
      actions.paintSite(side, layerOf.get(only.box)!, siteDto.get(only.id)!, back);
      return;
    }
    if (only?.kind === "zone") {
      const key = `${only.id}|${(prefs.hidden ?? []).join(",")}`;
      if (panelFor === key) return;
      panelFor = key;
      const hidden = new Set(boxIds.filter((b) => !isShown(prefs, b)));
      actions.paintZone(side, only.id, hidden, (boxes) => {
        let next = prefs;
        for (const b of boxes) if (!isShown(next, b)) next = toggleLayer(next, b);
        keep(next);
      }, back);
      return;
    }
    panelFor = undefined;
    paintLayers();
  }

  /** What a selected pin says about itself: which zone its hand belongs to, and
   *  whether dragging it can change that. */
  function describeSite(site: SiteShape & { kind: "site" }): string {
    const rule = siteRule.get(site.id);
    const where = site.zone === undefined ? "no zone yet" : (zoneName(site.zone) ?? "a zone");
    const others = site.alsoInside ?? [];
    const also = others.length === 0 ? "" : ` Also inside ${listNames(others)}, which does not count.`;
    if (site.strayFrom !== undefined) {
      return `"${site.title}" is dealt in ${site.strayFrom}, but its pin stands outside it. Drag it back into ${site.strayFrom}${rule?.rebinds === true ? ", or into another zone to move the hand" : ""}.`;
    }
    if (rule?.rebinds === true) {
      return site.zone === undefined
        ? `${site.title} is in ${where}. Drag it into one to bind it.${also}`
        : `${site.title} is in ${where}. Drag it to another to move the hand.${also}`;
    }
    if (rule?.fixedBy !== undefined) {
      return `${site.title} is in ${where}, fixed by the template "${rule.fixedBy}" for every hand it makes.${also}`;
    }
    return `${site.title} doesn't use the map's zones, so its pin only marks a spot.${also}`;
  }

  /** "a", "a and b", "a, b and c" - a list an author reads, not a join. */
  function listNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  /** Everything a picture can be told to do, in one place. Reached from its row
   *  (which works even when locked) and from a right-click on the map. */
  function backgroundMenu(b: MapBackgroundDto, at2: { x: number; y: number }): void {
    const order = map.backgrounds.map((x) => x.id);
    const at = order.indexOf(b.id);
    const canRaise = at >= 0 && at < order.length - 1;
    const canLower = at > 0;
    openContextMenu(at2.x, at2.y, [
      b.locked === true
        ? { label: "Unlock", onClick: () => actions.editBackground(b.id, { locked: false }) }
        : { label: "Lock in place", onClick: () => actions.editBackground(b.id, { locked: true }) },
      b.hidden === true
        ? { label: "Show", onClick: () => actions.editBackground(b.id, { hidden: false }) }
        : { label: "Hide", onClick: () => actions.editBackground(b.id, { hidden: true }) },
      // Fading is what makes a tracing base usable: three steps and back to full.
      { label: `Fade (${Math.round((b.opacity ?? 1) * 100)}%)`, onClick: () => {
        const steps = [1, 0.6, 0.35, 0.15];
        const now = steps.findIndex((v) => Math.abs(v - (b.opacity ?? 1)) < 0.02);
        actions.editBackground(b.id, { opacity: steps[(now + 1) % steps.length] });
      } },
      ...(canRaise ? [
        { label: "Bring to front", onClick: () => actions.restackBackground(b.id, "front") },
        { label: "Bring forward", onClick: () => actions.restackBackground(b.id, "forward") },
      ] : []),
      ...(canLower ? [
        { label: "Send backward", onClick: () => actions.restackBackground(b.id, "backward") },
        { label: "Send to back", onClick: () => actions.restackBackground(b.id, "back") },
      ] : []),
      { label: "Remove from the map", danger: true, onClick: () => actions.removeBackground(b.id) },
    ]);
  }

  // --- the strip ---------------------------------------------------------------
  // No camera buttons here: fit, fit-the-selection and zoom are the cluster in
  // the canvas's own corner, identical on all three canvases (canvas-controls.ts).

  function paintStrip(): void {
    paintSide();
    const chosen = surface.selection();

    const furnitureHint = commentArmed ? "Click where the comment goes" : furniture?.hint();
    if (furnitureHint !== undefined) {
      strip.replaceChildren(
        el("span", { className: "hint", text: furnitureHint }),
        el("span", { className: "stripgap" }),
        el("button", {
          className: "stripbtn cancel", tip: tipWithKey("Abandon this", "Esc"),
          onClick: () => { if (commentArmed) disarmComment(); else furniture?.cancel(); },
        }, iconNode("close", 12), "Cancel"),
      );
      return;
    }

    // Mid-gesture the strip says how to finish and how to get out, and nothing else.
    if (busy !== undefined) {
      strip.replaceChildren(
        el("span", { className: "hint", text: busy.drawing
          ? draft.length === 0
            ? `Click to place the first corner of ${busy.label}`
            : draft.length < 3
              ? `${busy.label}: ${plural(draft.length, "corner")} so far`
              : `Click the first corner of ${busy.label} again, or press Enter, to close it`
          : `Click where ${busy.label} sits` }),
        el("span", { className: "stripgap" }),
        el("button", { className: "stripbtn cancel", tip: tipWithKey("Abandon this", "Esc"), onClick: () => stopTool() }, iconNode("close", 12), "Cancel"),
      );
      return;
    }

    const legend = actions.coverageOn()
      ? [el("span", { className: "hint cover-legend", text: coverageLegend(actions.coverage(), Date.now()) })]
      : [];
    const toggle = el("button", {
      className: `stripbtn${editing ? " on" : ""}`,
      tip: editing ? "Back to reading the map" : "Draw zones, place hands, add pictures, frames and comments",
      onClick: () => actions.setEditing(!editing),
    }, editing ? iconNode("tick", 12) : iconNode("add", 12), editing ? "Done" : "Edit layout");

    if (!editing) {
      // Reading: one verb and the state of the map, quietly.
      const shown = items.filter((i) => i.kind === "site").length;
      const zones = map.zones.length;
      strip.replaceChildren(toggle,
        el("span", { className: "hint", text: refused ?? `${plural(zones, "zone")}, ${plural(shown, "hand")} shown.` }),
        ...legend, el("span", { className: "stripgap" }));
      return;
    }

    const what = chosen.length === 1 ? byId(chosen[0]!) : undefined;
    const said = refused ?? (what === undefined
      ? (chosen.length > 1 ? `${chosen.length} selected` : "Zones are the project's. Hands go to the active layer.")
      : what.kind === "background"
        ? `${what.title} is a picture behind the map. Drag it, or lock it once it's right.`
        : what.kind === "frame"
          ? `${what.title ?? "Frame"} is a frame. Drag its bar to move it, or double-click to rename it.`
          : what.kind === "zone"
              ? pickedVertex !== undefined
                ? `Corner ${pickedVertex + 1} of ${what.title} is picked. Delete removes it.`
                : `${what.title} is a zone. Drag a corner to reshape it, or a mid-point to add one.`
              : describeSite(what));
    const active = activeBox(prefs, boxIds);
    const activeLayer = active === undefined ? undefined : layerOf.get(active);
    const siteDot = el("i", { className: "maplayer-swatch" });
    if (activeLayer) siteDot.style.background = boxColour(activeLayer.box);
    strip.replaceChildren(
      toggle,
      el("div", { className: "striptools" },
        el("button", { className: "stripbtn", tip: "Trace a new zone on the map", onClick: () => trace(undefined, "New zone") },
          iconNode("add", 12), "Zone"),
        ...(activeLayer
          ? [el("button", { className: "stripbtn", tip: `A new hand for ${layerName(activeLayer)}, the active layer. Click where it goes.`, onClick: () => newSite() },
              iconNode("add", 12), "Hand", siteDot, el("span", { className: "stripbtn-sub", text: layerName(activeLayer) }))]
          : []),
        el("button", {
          className: "stripbtn",
          tip: "Put a picture behind the map, to place the content on",
          onClick: () => {
            // The camera NOW: the picture is sized against what the author is
            // looking at, and centred on the middle of it.
            const box = stage.getBoundingClientRect();
            const cam = surface.camera();
            actions.addBackground({
              view: { width: box.width, height: box.height },
              scale: cam.scale,
              at: { x: (box.width / 2 - cam.x) / cam.scale, y: (box.height / 2 - cam.y) / cam.scale },
            });
          },
        }, iconNode("add", 12), "Picture"),
        el("button", { className: "stripbtn", tip: "Draw a titled frame behind part of the map", onClick: () => furniture?.drawFrame() },
          iconNode("add", 12), "Frame"),
        el("button", { className: "stripbtn", tip: "Drop a comment on the map or on a hand", onClick: () => armComment() },
          iconNode("add", 12), "Comment"),
      ),
      el("span", { className: "hint", text: said }),
      ...legend,
      el("span", { className: "stripgap" }),
    );
  }

  // --- the canvas --------------------------------------------------------------
  let tokens = readCanvasTokens();
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
    // Below the label floor the map is shapes and dots with no names: the
    // rollover is how you ask which is which without zooming back in.
    hoverTip: (item, scale) => {
      if (item.kind === "site" && item.strayFrom !== undefined) {
        return `${item.title} is dealt in ${item.strayFrom}, but its pin stands outside it.`;
      }
      if (item.kind === "site" && item.alsoInside !== undefined && item.alsoInside.length > 0) {
        const own = item.zone === undefined ? undefined : zoneName(item.zone);
        return own === undefined
          ? `${item.title} sits inside ${listNames(item.alsoInside)}. Zones don't nest, so dropping it binds to the frontmost one only.`
          : `${item.title} belongs to ${own}. It also sits inside ${listNames(item.alsoInside)}, which counts for nothing. Zones are tags, so they don't nest, and a hand belongs to the frontmost zone around it.`;
      }
      if (item.kind === "site" && scale >= LABEL_FLOOR) {
        // The box is the one thing the label never says, and the tint only
        // hints at it.
        const layer = layerOf.get(item.box);
        return layer && map.layers.length > 1 ? `${item.title}, ${layerName(layer)}` : undefined;
      }
      if (scale >= LABEL_FLOOR) return undefined;
      return item.kind === "site" ? `${item.title}, ${layerName(layerOf.get(item.box)!)}` : item.title;
    },
    onActivate: (id) => {
      if (furniture?.activate(id) === true) return;
      const item = byId(id);
      if (item?.kind === "zone") actions.openZone(id);
      else if (item?.kind === "site") actions.openHand(item.box, id);
    },
    onSelectionChange: () => {
      pickedVertex = undefined;
      // Selecting a pin makes its box the active layer: the next "+ Hand" goes
      // where the author was just looking.
      const chosen = surface.selection();
      const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;
      if (only?.kind === "site" && activeBox(prefs, boxIds) !== only.box) {
        prefs = setActive(prefs, only.box);
        actions.setLayers(prefs);
      }
      repaint();
      paintStrip();
    },
    onDelete: () => {
      if (!editing) return;
      const chosen = surface.selection();
      if (furniture !== undefined && furniture.absorbDelete(chosen).length !== chosen.length) return;
      const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;
      if (pickedVertex !== undefined && only?.kind === "zone") removeVertex(only.id, pickedVertex);
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
          ...(editing ? [{ label: "Remove from the map", danger: true, onClick: () => actions.removeSite(item.box, item.id) }] : []),
        ]);
        return;
      }
      if (item?.kind === "background" && editing) {
        const dto = map.backgrounds.find((b) => b.id === item.id);
        if (dto) backgroundMenu(dto, { x: e.clientX, y: e.clientY });
        return;
      }
      if (item?.kind === "zone") {
        // Drawing-app layering, in a drawing app's words, offered only where it
        // would do something.
        const order = map.zones.map((z) => z.id);
        const at = order.indexOf(item.id);
        const canRaise = at >= 0 && at < order.length - 1;
        const canLower = at > 0;
        openContextMenu(e.clientX, e.clientY, [
          { label: `Open ${item.title}`, onClick: () => actions.openZone(item.id) },
          ...(editing && canRaise ? [
            { label: "Bring to front", onClick: () => actions.restackZone(item.id, "front") },
            { label: "Bring forward", onClick: () => actions.restackZone(item.id, "forward") },
          ] : []),
          ...(editing && canLower ? [
            { label: "Send backward", onClick: () => actions.restackZone(item.id, "backward") },
            { label: "Send to back", onClick: () => actions.restackZone(item.id, "back") },
          ] : []),
          ...(editing ? [{ label: "Remove from the map", danger: true, onClick: () => actions.reshapeZone(item.id, []) }] : []),
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
      // A dropped ZONE writes its new outline. It rebinds nobody (see applyOutline).
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind === "zone") {
          const polygon = worldOutline(item);
          const dto = map.zones.find((z) => z.id === item.id);
          if (dto) dto.polygon = polygon;
          actions.reshapeZone(item.id, polygon);
        }
      }
      // A dropped PICTURE keeps its new corner, coalesced: one gesture.
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind === "background") actions.editBackground(item.id, { x: move.x, y: move.y }, { coalesce: true });
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
          if (rule?.fixedBy !== undefined) {
            refused = `"${site.title}" stays in the zone its template "${rule.fixedBy}" gives every hand it makes, so moving its pin moves nothing.`;
          }
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
      repaint();
      paintStrip();
    },
    onCamera: () => { rememberCamera(cameraKey, surface.camera()); },
  });

  furniture = createFurniture({
    surface: () => surface as unknown as CanvasSurface<CanvasItem>,
    container: () => stage,
    get: () => map.furniture,
    save: (next, label, coalesce) => actions.setFurniture(next, label, coalesce),
    repaint: () => { repaint(); paintStrip(); },
  });

  /** Take a corner out, if the shape can spare it. A triangle cannot. */
  function removeVertex(zoneId: string, index: number): void {
    const zone = byId(zoneId);
    if (zone?.kind !== "zone") return;
    const next = withoutVertex(worldOutline(zone), index);
    if (!next) return;
    pickedVertex = undefined;
    applyOutline(zoneId, next);
  }

  /**
   * The painted layers. SPLIT deliberately: `paintNames` redraws the foreground
   * (names, the shape being traced or previewed), `paintHandlesNow` rebuilds the
   * chrome. Rebuilding chrome destroys the handle the pointer is holding, so a
   * vertex drag repaints the preview and nothing else.
   */
  function repaint(): void {
    paintNames();
    paintHandlesNow();
  }

  function paintNames(): void {
    const zonesShown = isShown(prefs, MAP_LAYER_ZONES);
    surface.setForeground((layer, scale, at) => {
      if (zonesShown) {
        paintZoneLabels(layer, scale, tokens, map.zones, (id) => {
          const item = at(id);
          return item?.kind === "zone" ? item : undefined;
        });
      }
      if (draft.length > 0) paintDraft(layer, scale, tokens, draft, pointer);
      if (preview) paintDraft(layer, scale, tokens, preview.polygon, undefined);
      const band = furniture?.draft();
      if (band) {
        layer.add(new Konva.Rect({
          x: band.x, y: band.y, width: band.w, height: band.h,
          stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale],
          listening: false,
        }));
      }
      if (scaling) {
        const r = scaling.rect;
        layer.add(new Konva.Rect({
          x: r.x, y: r.y, width: r.width, height: r.height,
          stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale],
          listening: false,
        }));
      }
    });
  }

  function paintHandlesNow(): void {
    // Handles are Edit layout's, and on exactly ONE selected thing.
    const chosen = surface.selection();
    const only = editing && chosen.length === 1 ? byId(chosen[0]!) : undefined;

    if (busy === undefined && only?.kind === "background") {
      const picture = only;
      surface.setChrome((layer, scale) => {
        paintScaleHandles(layer, scale, tokens,
          { x: picture.x, y: picture.y, width: picture.width, height: picture.height }, {
            preview: (rect) => {
              scaling = rect === undefined ? undefined : { id: picture.id, rect };
              paintNames();
            },
            commit: (rect) => {
              scaling = undefined;
              actions.editBackground(picture.id, rect, { coalesce: true });
            },
          });
      });
      return;
    }

    if (busy !== undefined || only === undefined || only.kind !== "zone") {
      surface.setChrome(undefined);
      return;
    }
    const zone = only;
    surface.setChrome((layer, scale) => {
      paintHandles(layer, scale, tokens, worldOutline(zone), {
        previewVertex: (index, to) => {
          preview = to === undefined ? undefined : { id: zone.id, polygon: withVertexAt(worldOutline(zone), index, to) };
          paintNames();
        },
        moveVertex: (index, to) => applyOutline(zone.id, withVertexAt(worldOutline(zone), index, to)),
        insertVertex: (index, at) => {
          applyOutline(zone.id, withVertexAfter(worldOutline(zone), index, at));
          pickedVertex = index + 1;
          repaint();
        },
        selectVertex: (index) => { pickedVertex = index; repaint(); paintStrip(); },
        menuForVertex: (index, e) => {
          const shrunk = withoutVertex(worldOutline(zone), index);
          openContextMenu(e.clientX, e.clientY, [{
            label: shrunk ? "Remove this corner" : "Remove this corner (a zone needs three)",
            danger: shrunk !== undefined,
            onClick: () => { if (shrunk) removeVertex(zone.id, index); },
          }]);
        },
      }, pickedVertex);
    });
  }

  /**
   * Comment markers, in the surface's marker group (design/annotation.md 3).
   * `itemAt` answers with SITES only: a marker dropped on a zone stays on the
   * canvas rather than following the zone's outline about.
   */
  surface.setMarkers(markerPainter<MapItem>({
    markers: () => actions.markers(),
    open: (threadId, anchor) => actions.openThread(threadId, anchor),
    moved: (threadId, x, y, item) => actions.moveMarker(threadId, x, y, item),
    itemAt: (x, y) => items.find((i) =>
      i.kind === "site" && x >= i.x && y >= i.y && x <= i.x + i.width && y <= i.y + i.height)?.id,
    host: () => stage,
  }, () => tokens));

  function armComment(): void {
    commentArmed = true;
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        disarmComment();
        const over = items.find((i) =>
          i.kind === "site" && at.x >= i.x && at.y >= i.y && at.x <= i.x + i.width && at.y <= i.y + i.height);
        // On a site, the stored position is an OFFSET from it, so the marker keeps
        // its place beside the hand when the hand is dragged to another zone.
        const point = over ? { x: at.x - over.x, y: at.y - over.y } : at;
        actions.startThread(point, over?.id, proxyFor(at));
      },
      onCancel: () => { commentArmed = false; paintStrip(); },
    });
    paintStrip();
  }

  function disarmComment(): void {
    commentArmed = false;
    surface.setTool(undefined);
    paintStrip();
  }

  /** Open a marker's thread from OUTSIDE the canvas: the Review Feedback walk. */
  function openMarker(threadId: string): boolean {
    const marker = actions.markers().find((m) => m.id === threadId);
    if (!marker) return false;
    const point = markerPoint(marker, (id) => items.find((i) => i.id === id));
    if (!point) return false;
    surface.centreAt(point);
    actions.openThread(threadId, proxyFor(point));
    return true;
  }

  /** A zero-size element at a map point, for the composer popover to hang off. */
  function proxyFor(at: { x: number; y: number }): HTMLElement {
    stage.querySelector(".cmt-marker-proxy")?.remove();
    const screen = surface.toScreen(at);
    const proxy = el("div", { className: "cmt-marker-proxy" });
    proxy.style.left = `${Math.round(screen.x)}px`;
    proxy.style.top = `${Math.round(screen.y)}px`;
    stage.append(proxy);
    return proxy;
  }

  /** The layers changed: rebuild what is drawn, keep the camera and whatever of
   *  the selection is still on the map. */
  function rebuild(): void {
    items = buildItems();
    dressCoverage();
    const still = surface.selection().filter((id) => items.some((i) => i.id === id));
    surface.setItems(items);
    if (still.length !== surface.selection().length) surface.select(still);
    panelFor = undefined;
    repaint();
    paintStrip();
  }

  items = buildItems();
  dressCoverage();
  surface.setItems(items);
  repaint();
  const remembered = recallCamera(cameraKey);
  if (remembered) surface.setCamera(remembered);
  else surface.fitAll();
  paintStrip();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); repaint(); });
  // A picture finishing its load is the one repaint nobody asked for.
  const unwatchImages = onImageReady(() => { surface.setItems(items); repaint(); });

  return {
    repaintMarkers() { surface.repaintMarkers(); },
    openMarker,
    refreshCoverage() { dressCoverage(); surface.setItems(items); paintStrip(); },
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
      panelFor = undefined;
      repaint();
      paintStrip();
    },
    destroy() {
      rememberCamera(cameraKey, surface.camera());
      unwatchImages();
      unwatch();
      surface.destroy();
    },
  };
}

/** The box a hand belongs to on the map, placed or waiting. */
export const siteBoxOf = (map: ProjectMapViewDto, handId: string): string | undefined =>
  map.layers.find((l) => l.sites.some((s) => s.id === handId) || l.unplaced.some((u) => u.id === handId))?.box;
