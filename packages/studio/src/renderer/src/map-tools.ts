// ---------------------------------------------------------------------------
// The project map's TOOLS: tracing a zone, placing a pin, making a hand where
// the click lands, the handles that reshape a zone and scale a picture, the
// comment tool, and the strip that offers them and says how each one ends.
//
// A zone is TRACED, never conjured as a square. Click to lay vertices, click the
// first one again or press Enter to close, Escape to abandon; then drag its
// vertices to reshape, or a mid-edge handle to add one. That is the old
// system's canvas (../storylets-old, StorymapCanvasZoneHandles and its
// draw-zone tool), whose conventions were paid for once already. The drawing
// and the geometry are map-edit.ts; the gestures are here.
//
// ADDING is a control, not a menu: the strip carries the verbs, and the side
// panel (map-side.ts) the things waiting to be placed.
//
// Out of map-view.ts, which mounts the canvas and decides what a drop means,
// and handed the pieces only the view knows, the way the furniture controller
// is. The tools hold their own state (what is being traced, which corner is
// picked, the picture being scaled) and nothing else.
// ---------------------------------------------------------------------------

import { el, iconNode, openAnchoredPanel, plural } from "@wildwinter/app-shell";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { boxColour } from "./box-tint.js";
import { STRIP_ICON_PX, armedStrip, sharedToolStrip, stripAddButton } from "./canvas-controls.js";
import { paintZoneLabels, worldOutline, zoneShape } from "./map-art.js";
import { paintDraftRect } from "./furniture-art.js";
import { createCommentTool, type CommentTool } from "./comment-markers.js";
import { coverageLegend } from "./coverage-art.js";
import {
  applyRect, closesShape, paintDraft, paintHandles, paintScaleHandles, withVertexAfter, withVertexAt, withoutVertex,
} from "./map-edit.js";
import { MAP_LAYER_ZONES, activeBox, isShown, showLayer } from "./map-layers.js";
import { describeSite, editHint, layerName, tracingHint, type SiteRule } from "./map-words.js";
import type { CanvasSurface } from "./canvas-surface.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { FurnitureController } from "./furniture-edit.js";
import type { MapItem, MapViewActions } from "./map-view.js";
import type { Polygon, ViewPoint } from "@storylet-studio/model";
import type { MapLayerPrefs, ProjectMapLayerDto, ProjectMapViewDto } from "../../shared/api.js";

/** The hand-kind picker's width: the deck picker's (inspector.ts). */
const HAND_PICKER_WIDTH = 240;

export interface MapToolDeps {
  /** The canvas's container, which a new picture is sized against. */
  stage: HTMLElement;
  strip: HTMLElement;
  map: ProjectMapViewDto;
  /** Edit layout, rather than reading. */
  editing: boolean;
  boxIds: readonly string[];
  layerOf: ReadonlyMap<string, ProjectMapLayerDto>;
  siteRule: ReadonlyMap<string, SiteRule>;
  surface: () => CanvasSurface<MapItem>;
  /** The items as the canvas holds them: the view's own array, edited in place. */
  items: () => MapItem[];
  byId: (id: string) => MapItem | undefined;
  zoneName: (id: string | undefined) => string | undefined;
  prefs: () => MapLayerPrefs;
  keep: (next: MapLayerPrefs) => void;
  tokens: () => CanvasTokens;
  furniture: () => FurnitureController | undefined;
  /** Why the last drop did not rebind, when there is something to say. */
  refused: () => string | undefined;
  /** Paint the side panel, then the strip: everything a change of tool or
   *  selection touches outside the canvas. */
  refresh: () => void;
  actions: MapViewActions;
}

export interface MapTools {
  /** Build the comment tool, which draws its markers at once: AFTER the
   *  surface, like the furniture. */
  attach: () => void;
  /** Trace an outline: for an existing undrawn zone, or for one not yet declared. */
  trace: (tag: string | undefined, label: string) => void;
  /** Place a hand that has no pin yet: the next click drops it, wherever that is. */
  place: (box: string, handId: string, label: string) => void;
  /** Something is being traced or placed. */
  busy: () => boolean;
  /** The zone corner picked for Delete, if one is. */
  pickedVertex: () => number | undefined;
  /** The selection moved on: no corner is picked any more. */
  unpick: () => void;
  /** Take a corner out, if the shape can spare it. A triangle cannot. */
  removeVertex: (zoneId: string, index: number) => void;
  /** A picture's new place or size, into the canvas's copy and the map's. */
  applyPicture: (id: string, rect: { x: number; y: number; width?: number; height?: number }) => void;
  /** The foreground and the handles, both. */
  repaint: () => void;
  /** The strip alone. The side panel is the view's (`refresh` does both). */
  paintStrip: () => void;
  /** Open one marker's thread, centring on it. False when it is not here. */
  openMarker: (threadId: string) => boolean;
}

export function createMapTools(deps: MapToolDeps): MapTools {
  const { map, editing, boxIds, layerOf, actions } = deps;

  // --- what is being traced or placed -----------------------------------------
  let busy: { label: string; tag?: string; drawing: boolean } | undefined;
  let draft: Polygon = [];
  let pointer: ViewPoint | undefined;
  let preview: { id: string; polygon: Polygon } | undefined;
  let pickedVertex: number | undefined;
  let scaling: { id: string; rect: { x: number; y: number; width: number; height: number } } | undefined;
  /** Built after the surface, like the furniture: the strip asks it whether it
   *  is armed, and the strip can be painted before then. */
  let comments: CommentTool | undefined;

  /**
   * A zone's new outline: applied HERE first, then persisted. The canvas holds
   * its own copy of every shape, so persisting alone left the picture as it was:
   * an inserted corner appeared for one frame and vanished on the next repaint.
   *
   * Nothing is rebound here, and that is the point (2026-08-06): a hand's zone is
   * the hand's own binding, changed only by dragging that hand's pin.
   */
  function applyOutline(zoneId: string, polygon: Polygon): void {
    const items = deps.items();
    const at = items.findIndex((i) => i.id === zoneId);
    const zone = at >= 0 ? items[at] : undefined;
    if (!zone || zone.kind !== "zone") return;
    items[at] = { kind: "zone", ...zoneShape({ id: zoneId, title: zone.title, name: zone.name, polygon }) };
    const dto = map.zones.find((z) => z.id === zoneId);
    if (dto) dto.polygon = polygon;
    preview = undefined;
    deps.surface().setItems(items);
    repaint();
    deps.refresh();
    actions.reshapeZone(zoneId, polygon);
  }

  /**
   * A picture's new place or size: applied HERE first, then persisted, as an
   * outline is. The save is a quiet one (no remount), so persisting alone left
   * the canvas drawing the picture at its old size, and the next rebuild from
   * the map's own copy (any layer control) put a moved picture back where it
   * started.
   */
  function applyPicture(id: string, rect: { x: number; y: number; width?: number; height?: number }): void {
    applyRect(deps.items(), id, rect);
    const dto = map.backgrounds.find((b) => b.id === id);
    if (dto) Object.assign(dto, rect);
  }

  function removeVertex(zoneId: string, index: number): void {
    const zone = deps.byId(zoneId);
    if (zone?.kind !== "zone") return;
    const next = withoutVertex(worldOutline(zone), index);
    if (!next) return;
    pickedVertex = undefined;
    applyOutline(zoneId, next);
  }

  // --- the tools ----------------------------------------------------------------

  function stopTool(): void {
    busy = undefined;
    draft = [];
    pointer = undefined;
    deps.surface().setTool(undefined);
    repaint();
    deps.refresh();
  }

  function trace(tag: string | undefined, label: string): void {
    const surface = deps.surface();
    busy = { label, drawing: true, ...(tag !== undefined ? { tag } : {}) };
    draft = [];
    pointer = undefined;
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        if (closesShape(draft, at, surface.scale())) { finishTrace(); return; }
        draft = [...draft, { x: Math.round(at.x), y: Math.round(at.y) }];
        repaint();
        deps.refresh();
      },
      onMove: (at) => { pointer = at; repaint(); },
      onCommit: () => finishTrace(),
      onCancel: () => stopTool(),
    });
    repaint();
    deps.refresh();
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

  function place(box: string, handId: string, label: string): void {
    busy = { label, drawing: false };
    deps.surface().setTool({
      cursor: "crosshair",
      onClick: (at) => {
        // A tool takes over the click so a pin can be dropped INSIDE a zone;
        // landing in one is what binds the hand.
        stopTool();
        actions.movedSites(box, [{ id: handId, x: Math.round(at.x), y: Math.round(at.y) }]);
      },
      onCancel: () => stopTool(),
    });
    deps.refresh();
  }

  /** "+ Hand": a new hand in the ACTIVE layer's box, made where the click lands,
   *  of the template picked from the button's menu (or standalone). */
  function newSite(template?: { id: string; title: string }): void {
    const box = activeBox(deps.prefs(), boxIds);
    if (box === undefined) return;
    busy = { label: template !== undefined ? `a new hand in ${template.title}` : `a new hand for ${layerName(layerOf.get(box)!)}`, drawing: false };
    deps.surface().setTool({
      cursor: "crosshair",
      onClick: (at) => {
        stopTool();
        // Into a hidden layer, the layer is shown: the new hand appears where
        // it was put, rather than being made out of sight.
        const prefs = deps.prefs();
        if (!isShown(prefs, box)) deps.keep(showLayer(prefs, box));
        actions.newSite(box, { x: Math.round(at.x), y: Math.round(at.y) }, template?.id);
      },
      onCancel: () => stopTool(),
    });
    deps.refresh();
  }

  /**
   * "+ Hand ▸": the active box's hand templates by the designer's own word for
   * each ("Places in the village", "People you can talk to"), then Standalone,
   * the hand that pulls from the whole box. The immersive designer's sign-off
   * point: the author's word belongs where hands are MADE, not only under a
   * hand once it exists. The deck picker's shape (inspector.ts). A box with no
   * templates has nothing to choose between, so the button goes straight on.
   */
  function pickHandKind(anchor: HTMLElement): void {
    const box = activeBox(deps.prefs(), boxIds);
    const templates = box === undefined ? [] : layerOf.get(box)?.templates ?? [];
    if (templates.length === 0) { newSite(); return; }
    const panel = openAnchoredPanel({ anchor, className: "deckpick", title: "Which kind of hand", width: HAND_PICKER_WIDTH, prefer: "below" });
    if (!panel) return;
    panel.body.classList.add("deckpick-list");
    const option = (text: string, tip: string, go: () => void): HTMLElement => {
      const b = el("button", { className: "deckpick-opt", text, tip, onClick: () => { panel.close(); go(); } });
      panel.body.append(b);
      return b;
    };
    const first = templates.map((t) => option(t.title, `A new hand of this kind. Click where it goes.`, () => newSite(t)))[0];
    option("Standalone", "A hand of no template, pulling from the whole box. Click where it goes.", () => newSite());
    first?.focus();
  }

  // --- the painted layers ---------------------------------------------------------

  /**
   * The painted layers. SPLIT deliberately: `paintNames` redraws the foreground
   * (names, the shape being traced or previewed), `paintChrome` rebuilds the
   * handles. Rebuilding the handles destroys the one the pointer is holding, so
   * a vertex drag repaints the preview and nothing else.
   */
  function repaint(): void {
    paintNames();
    paintChrome();
  }

  function paintNames(): void {
    const zonesShown = isShown(deps.prefs(), MAP_LAYER_ZONES);
    deps.surface().setForeground((layer, scale, at) => {
      const tokens = deps.tokens();
      if (zonesShown) {
        paintZoneLabels(layer, scale, tokens, map.zones, (id) => {
          const item = at(id);
          return item?.kind === "zone" ? item : undefined;
        });
      }
      if (draft.length > 0) paintDraft(layer, scale, tokens, draft, pointer);
      if (preview) paintDraft(layer, scale, tokens, preview.polygon, undefined);
      const band = deps.furniture()?.draft();
      if (band) paintDraftRect(layer, scale, tokens, band);
      if (scaling) paintDraftRect(layer, scale, tokens, scaling.rect);
    });
  }

  function paintChrome(): void {
    const surface = deps.surface();
    // Handles are Edit layout's, and on exactly ONE selected thing.
    const chosen = surface.selection();
    const only = editing && chosen.length === 1 ? deps.byId(chosen[0]!) : undefined;

    if (busy === undefined && only?.kind === "background") {
      const picture = only;
      surface.setChrome((layer, scale) => {
        paintScaleHandles(layer, scale, deps.tokens(),
          { x: picture.x, y: picture.y, width: picture.width, height: picture.height }, {
            preview: (rect) => {
              scaling = rect === undefined ? undefined : { id: picture.id, rect };
              paintNames();
            },
            commit: (rect) => {
              scaling = undefined;
              applyPicture(picture.id, rect);
              surface.setItems(deps.items());
              repaint();
              deps.refresh();
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
      paintHandles(layer, scale, deps.tokens(), worldOutline(zone), {
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
        selectVertex: (index) => { pickedVertex = index; repaint(); deps.refresh(); },
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

  // --- the strip ---------------------------------------------------------------
  // No camera buttons here: fit, fit-the-selection and zoom are the cluster in
  // the canvas's own corner, identical on all three canvases (canvas-controls.ts).

  function paintStrip(): void {
    const { strip } = deps;
    const surface = deps.surface();
    const chosen = surface.selection();

    const shared = sharedToolStrip(comments, deps.furniture());
    if (shared !== undefined) { strip.replaceChildren(...shared); return; }

    // Mid-gesture the strip says how to finish and how to get out, and nothing else.
    if (busy !== undefined) {
      strip.replaceChildren(...armedStrip(tracingHint(busy.label, busy.drawing, draft.length), () => stopTool()));
      return;
    }

    const legend = actions.coverageOn()
      ? [el("span", { className: "hint cover-legend", text: coverageLegend(actions.coverage(), Date.now()) })]
      : [];
    const toggle = el("button", {
      className: `stripbtn${editing ? " on" : ""}`,
      tip: editing ? "Back to reading the map" : "Draw zones, place hands, add pictures, frames and comments",
      onClick: () => actions.setEditing(!editing),
    }, editing ? iconNode("tick", STRIP_ICON_PX) : iconNode("add", STRIP_ICON_PX), editing ? "Done" : "Edit layout");

    const refused = deps.refused();
    if (!editing) {
      // Reading: one verb and the state of the map, quietly.
      const shown = deps.items().filter((i) => i.kind === "site").length;
      const zones = map.zones.length;
      strip.replaceChildren(toggle,
        el("span", { className: "hint", text: refused ?? `${plural(zones, "zone")}, ${plural(shown, "hand")} shown.` }),
        ...legend, el("span", { className: "stripgap" }));
      return;
    }

    const what = chosen.length === 1 ? deps.byId(chosen[0]!) : undefined;
    const said = refused ?? editHint(what, chosen.length, pickedVertex,
      (site) => describeSite(site, deps.siteRule.get(site.id), deps.zoneName));
    const active = activeBox(deps.prefs(), boxIds);
    const activeLayer = active === undefined ? undefined : layerOf.get(active);
    const siteDot = el("i", { className: "maplayer-swatch" });
    if (activeLayer) siteDot.style.background = boxColour(activeLayer.box);
    strip.replaceChildren(
      toggle,
      el("div", { className: "striptools" },
        stripAddButton("Zone", "Trace a new zone on the map", () => trace(undefined, "New zone")),
        ...(activeLayer
          ? [stripAddButton("Hand",
              activeLayer.templates.length > 0
                ? `A new hand for ${layerName(activeLayer)}, the active layer: pick its kind, then click where it goes.`
                : `A new hand for ${layerName(activeLayer)}, the active layer. Click where it goes.`,
              (e) => pickHandKind(e.currentTarget as HTMLElement),
              siteDot, el("span", { className: "stripbtn-sub", text: layerName(activeLayer) }),
              ...(activeLayer.templates.length > 0 ? [iconNode("dropdown", 10)] : []))]
          : []),
        stripAddButton("Picture", "Put a picture behind the map, to place the content on", () => {
          // The camera NOW: the picture is sized against what the author is
          // looking at, and centred on the middle of it.
          const box = deps.stage.getBoundingClientRect();
          actions.addBackground({
            view: { width: box.width, height: box.height },
            scale: surface.scale(),
            at: surface.visibleCentre(),
          });
        }),
        stripAddButton("Frame", "Draw a titled frame behind part of the map", () => deps.furniture()?.drawFrame()),
        stripAddButton("Comment", "Drop a comment on the map or on a hand", () => comments?.arm()),
      ),
      el("span", { className: "hint", text: said }),
      ...legend,
      el("span", { className: "stripgap" }),
    );
  }

  /**
   * Comment markers and the tool that drops them (design/annotation.md 3).
   * Filed against PINS only: a marker dropped on a zone stays on the canvas
   * rather than following the zone's outline about. On a pin is judged by its
   * disc, which holds its size on screen, not by its box.
   */
  function attach(): void {
    comments = createCommentTool<MapItem>({
      surface: deps.surface(), host: deps.stage,
      items: () => deps.items(),
      carries: (i) => i.kind === "site",
      markers: () => actions.markers(),
      openThread: (threadId, anchor) => actions.openThread(threadId, anchor),
      startThread: (at, item, anchor) => actions.startThread(at, item, anchor),
      moveMarker: (threadId, x, y, item) => actions.moveMarker(threadId, x, y, item),
      tokens: () => deps.tokens(),
      changed: () => deps.refresh(),
    });
  }

  return {
    attach,
    trace,
    place,
    busy: () => busy !== undefined,
    pickedVertex: () => pickedVertex,
    unpick: () => { pickedVertex = undefined; },
    removeVertex,
    applyPicture,
    repaint,
    paintStrip,
    openMarker: (threadId) => comments?.open(threadId) === true,
  };
}
