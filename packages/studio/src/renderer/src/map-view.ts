// ---------------------------------------------------------------------------
// The map: a box's zones seen from above, with its hands pinned on them.
//
// An ORDINARY view of a box, and the same gesture grammar as the other two
// canvases: click selects, double-click opens the thing in the editor, right-click
// offers what that thing can do. The map is the tag data you already have
// (design/graphical-views.md section 2): a zone IS a tag of a spatial group and its
// outline lives in that tag; a pin is a hand's position in the arrangement sidecar.
//
// ADDING is a control, not a menu. The first cut put "place zone X" and "pin hand
// Y" in the context menu, one item per undrawn zone and unplaced hand, which grew
// with the project and was the wrong shape for the commonest act on a map. The strip
// now carries the verbs, and a chip for anything waiting to be placed: pick what,
// then say where.
//
// A zone is TRACED, never conjured as a square. Click to lay vertices, click the
// first one again or press Enter to close, Escape to abandon; then drag its vertices
// to reshape, or a mid-edge handle to add one. That is the old system's canvas
// (../storylets-old, StorymapCanvasZoneHandles and its draw-zone tool), whose
// conventions were paid for once already.
//
// Zones and sites share ONE surface and one selection, with each item saying which
// it is. Two stacked surfaces would mean two cameras to keep in step and two
// selections to reconcile, for no gain.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { colourIndex } from "../../shell/colour.js";
import { openContextMenu } from "./context-menu.js";
import { mountCanvasSurface, type CanvasItem, type CanvasSurface, type DrawContext } from "./canvas-surface.js";
import { mapCameraKey, recallCamera, rememberCamera } from "./canvas-memory.js";
import { readCanvasTokens, watchCanvasTokens } from "./canvas-tokens.js";
import {
  backgroundShape, drawBackground, drawSite, drawZone, paintZoneLabels, sitePoint, siteShape, zoneShape,
  LABEL_FLOOR, type BackgroundShape, type SiteShape, type ZoneShape,
} from "./map-art.js";
import { onImageReady } from "./image-cache.js";
import {
  drawFrame, frameShape, type FrameShape,
} from "./furniture-art.js";
import { createFurniture, type FurnitureController } from "./furniture-edit.js";
import { markerPainter, markerPoint } from "./comment-markers.js";
import { coverageLegend, handHeat } from "./coverage-art.js";
import {
  closesShape, paintDraft, paintHandles, paintScaleHandles, withVertexAfter, withVertexAt, withoutVertex,
} from "./map-edit.js";
import { zonesAt } from "@storylet-studio/model";
import type { Polygon, ViewPoint } from "@storylet-studio/model";
import type { BoxMapDto, CanvasFurnitureDto, CommentMarkerDto, CoverageOverlayDto, MapBackgroundDto } from "../../shared/api.js";
import Konva from "konva";

export interface MapViewActions {
  /** Double-click a zone: its tag group's page, where the zone's properties are. */
  openZone: (tagId: string) => void;
  /** Double-click a site: the hand's page. */
  openHand: (handId: string) => void;
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
  /** Sites moved or were placed: where each one now is. Which zone that turns out
   *  to be, and therefore which hands are rebound, is decided in main from the
   *  position over the geometry: one rule, one place (mutate.ts). */
  movedSites: (moves: { id: string; x: number; y: number }[]) => void;
  /** Take a hand off the map. The hand itself stays; only its site goes. */
  removeSite: (handId: string) => void;
  /** Show a different spatial group's map. */
  showGroup: (groupId: string) => void;
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
}

export interface MountedMapView {
  /** Hands whose zone changed because of an edit here: main's answer to a site
   *  drop or a reshaped outline. `zone` null means the hand now sits in none,
   *  which the Problems bar will be naming as an error. */
  rebound: (changes: { id: string; zone: string | null }[]) => void;
  /** Redraw the comment markers alone. Not a remount: that would lose the camera
   *  and the selection. */
  /** Open one marker's thread, centring the canvas on it: the feedback walk's
   *  way in. False when that thread is not a marker on this canvas. */
  openMarker: (threadId: string) => boolean;
  repaintMarkers: () => void;
  /** The overlay came, went or was re-run (see node-view). */
  refreshCoverage: () => void;
  destroy: () => void;
}

/** One item on the map. Zones and sites share a surface, so each says which it is. */
type MapItem =
  | (BackgroundShape & { kind: "background" })
  | FrameShape
  | (ZoneShape & { kind: "zone" })
  | (SiteShape & { kind: "site" })

export function mountMapView(
  host: HTMLElement, boxId: string, map: BoxMapDto, actions: MapViewActions,
): MountedMapView {
  const stage = el("div", { className: "nodestage" });
  const strip = el("div", { className: "nodestrip" });
  // The map's shape is the Board's map mode: the canvas takes the big column
  // and a side panel carries the CONTENTS. A map is wide and shallow (the
  // strip is one line), so the room to spend is on the right, and the strip
  // stays for verbs and state while the nouns live where there is space.
  const side = el("aside", { className: "mapside" });
  const main = el("div", { className: "mapmain-ed" }, stage, strip);
  host.replaceChildren(el("div", { className: "mapwrap" }, main, side));

  /** A zone's name from its id: what a pin is coloured by.
   *
   *  Undrawn zones count. A hand can be bound to a zone nobody has traced yet,
   *  and its pin saying "in a zone" when the tag has a perfectly good name would
   *  be the map being coy about something it knows. */
  const zoneName = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return map.zones.find((z) => z.id === id)?.gameId ?? map.undrawn.find((z) => z.id === id)?.gameId;
  };

  /**
   * The zones a site sits inside that are NOT the one its hand belongs to.
   *
   * Overlapping outlines are legitimate (a market square inside a district) and
   * the model resolves a point to the frontmost: that is `zoneAt`, and it is what
   * a DRAG binds to. What the picture cannot say is that the other outlines count
   * for nothing, so the site is marked and the strip explains.
   *
   * Excluding the site's OWN zone rather than just the frontmost, which a first
   * pass got wrong. A site's zone comes from its hand's binding (`chosen`), NOT
   * from geometry - the two are deliberately separate - so they can disagree: draw
   * a new outline over an existing site and the frontmost zone is one the hand has
   * never heard of. Taking `slice(1)` would then have named the site's own zone as
   * something that "counts for nothing", which is precisely backwards.
   */
  const alsoInside = (at: ViewPoint, own: string | undefined): string[] =>
    zonesAt(at, map.zones).filter((id) => id !== own).map((id) => zoneName(id) ?? "a zone");

  const items: MapItem[] = [
    // Pictures FIRST, so they are a band structurally below every zone: no z
    // value can put an image over a zone, because the bands are the array order.
    // A hidden one is not built at all - hiding is not the same as locking, and a
    // picture nobody wants to see should not be framed by a fit either.
    ...map.backgrounds.filter((b) => b.hidden !== true).map((b): MapItem => ({
      kind: "background",
      ...backgroundShape(b),
    })),
    // Frames above the pictures and below the zones: furniture describes the
    // map, so it sits on the base and under the thing it describes.
    ...map.furniture.frames.map((r): MapItem => frameShape(r)),
    ...map.zones.map((zone): MapItem => ({
      kind: "zone",
      ...zoneShape({ id: zone.id, title: zone.gameId, name: zone.gameId, polygon: zone.polygon }),
    })),
    // Sites after the zones, so they draw on top and the pointer finds them first.
    ...map.sites.map((site): MapItem => ({
      kind: "site",
      ...siteShape({
        id: site.id, title: site.gameId, name: site.gameId, at: { x: site.x, y: site.y },
        ...(site.zone !== undefined
          ? { zone: site.zone, ...(zoneName(site.zone) !== undefined ? { zoneName: zoneName(site.zone)! } : {}) }
          : {}),
      }),
      ...((): { alsoInside?: string[] } => {
        const others = alsoInside({ x: site.x, y: site.y }, site.zone);
        return others.length > 0 ? { alsoInside: others } : {};
      })(),
    })),
  ];

  /**
   * Put the coverage reading on the sites.
   *
   * After `siteShape` rather than through it: a site's SHAPE comes from where
   * the hand sits, and heat is a mode that comes and goes over a canvas that
   * stays up. Re-run on every repaint, like the node canvas's faces.
   */
  const dressCoverage = (): void => {
    const cover = actions.coverage();
    for (const item of items) {
      if (item.kind !== "site") continue;
      // A site IS a hand on the map, so the hand's heat is the site's.
      item.heat = cover === undefined ? undefined : handHeat(item.id, cover);
    }
  };
  dressCoverage();

  // Per GROUP, not merely per box: a box can carry several maps (a district and
  // a building interior), and they are different places to be looking.
  const cameraKey = mapCameraKey(boxId, map.groupId);

  /** What each pin's hand can do about its binding: whether dragging it means
   *  anything, and if not, why not. Beside the items rather than in them, because
   *  it belongs to the HAND rather than to the drawing. */
  const siteRule = new Map(map.sites.map((p) => [p.id, { rebinds: p.rebinds, fixedBy: p.fixedBy }]));

  const byId = (id: string): MapItem | undefined => items.find((i) => i.id === id);
  /** Frames and stickies, shared with the node canvas (furniture-edit.ts). Built
   *  after the surface, which its callbacks close over. */
  let furniture: FurnitureController | undefined;
  /** The comment tool is armed: the next click drops a marker. */
  let commentArmed = false;
  const worldOutline = (z: ZoneShape): Polygon => z.outline.map((p) => ({ x: z.x + p.x, y: z.y + p.y }));
  // --- what is being traced or placed -----------------------------------------
  /** The zone being traced (an existing tag, or a new one), or the hand being
   *  placed. Undefined means the ordinary select-and-drag canvas. */
  let busy: { label: string; tag?: string; drawing: boolean } | undefined;
  let draft: Polygon = [];
  let pointer: ViewPoint | undefined;
  /** A vertex mid-drag: the shape to draw until it lands. */
  let preview: { id: string; polygon: Polygon } | undefined;
  /** Which corner of the selected zone is picked out, for Delete. */
  let pickedVertex: number | undefined;
  /** Why the last drop did not rebind, when there is something to say. Cleared by
   *  the next drop, so it reads as a reply to what just happened. */
  let refused: string | undefined;
  /** A picture being scaled: the rectangle it WOULD have, drawn until it lands.
   *  Never written into the item mid-drag, or the handle in the hand dies. */
  let scaling: { id: string; rect: { x: number; y: number; width: number; height: number } } | undefined;

  /**
   * A zone's new outline: applied HERE first, then persisted.
   *
   * The canvas holds its own copy of every shape (that is what the surface draws
   * and hit-tests), so persisting alone changed the shard and left the picture
   * exactly as it was: an inserted corner appeared for one frame and vanished on
   * the next repaint, and a dragged corner sprang back. The lab did not catch it
   * because the lab updated its own model, which the app was not doing - a harness
   * has to mirror the app's data flow or it stops being evidence about the app.
   */
  function applyOutline(zoneId: string, polygon: Polygon): void {
    const at = items.findIndex((i) => i.id === zoneId);
    const zone = at >= 0 ? items[at] : undefined;
    if (!zone || zone.kind !== "zone") return;
    items[at] = { kind: "zone", ...zoneShape({ id: zoneId, title: zone.title, name: zone.name, polygon }) };
    preview = undefined;
    surface.setItems(items);
    repaint();
    paintStrip();
    actions.reshapeZone(zoneId, polygon);
    // Nothing is rebound here, and that is the point (2026-08-06). Reshaping a
    // zone used to re-derive every pin's zone from the new geometry, which meant
    // nudging one polygon could quietly move hands into it. A hand's zone is the
    // hand's own binding now, changed only by dragging that hand's pin: one
    // gesture, one meaning. A pin left sitting outside the zone it belongs to is
    // visible and harmless; a hand rebound by somebody tidying an outline is
    // neither.
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
    // Under three points there is no shape, so this is an abandon rather than a
    // save: better than writing a zone nobody can see.
    if (draft.length < 3) { stopTool(); return; }
    const shape = draft;
    const tag = busy?.tag;
    stopTool();
    if (tag !== undefined) actions.placeZone(tag, shape);
    else actions.newZone(shape);
  }

  /** Place a hand: the next click drops its pin, wherever that is. */
  function place(handId: string, label: string): void {
    busy = { label, drawing: false };
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        // A tool takes over the click so a pin can be dropped INSIDE a zone rather
        // than only on empty ground and dragged in afterwards; landing in one is
        // what binds the hand.
        stopTool();
        actions.movedSites([{ id: handId, x: Math.round(at.x), y: Math.round(at.y) }]);
      },
      onCancel: () => stopTool(),
    });
    paintStrip();
  }

  // --- the strip ---------------------------------------------------------------
  // No camera buttons here: fit, fit-the-selection and zoom are the cluster in
  // the canvas's own corner, identical on all three canvases
  // (canvas-controls.ts). The strip is for what is true of THIS map.

  /** Which group's map this is, and a way to the others. */
  function groupControl(): HTMLElement | null {
    if (map.groups.length === 0) return null;
    const here = map.groups.find((g) => g.id === map.groupId);
    // A bare group name at the far left told a reader nothing: "zone" is not
    // obviously the NAME of the thing being mapped until somebody says so.
    if (map.groups.length === 1) {
      return el("span", { className: "maphere" },
        el("span", { className: "maphere-of", text: "Map of" }),
        el("span", { className: "maphere-name", text: here?.gameId ?? "" }));
    }
    const select = document.createElement("select");
    select.className = "mapgroup";
    for (const group of map.groups) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.gameId;
      option.selected = group.id === map.groupId;
      select.append(option);
    }
    select.addEventListener("change", () => actions.showGroup(select.value));
    return select;
  }

  /**
   * The side panel: the map's CONTENTS, one row a thing. The strip carried a
   * chip per undrawn zone, per picture and per unplaced hand, which was
   * unusable at the Village's thirteen unplaced hands (one non-wrapping line);
   * a first fix folded each family into a counted menu chip, and the author's
   * ruling took it further the same day: a wide, shallow view has its spare
   * room on the RIGHT, so the contents live there, which is also the Board's
   * own map shape (canvas in the big column, a side panel beside it).
   *
   * Rows act: a drawn zone or a placed hand selects itself on the canvas and
   * comes into view; an undrawn zone arms its trace; an unplaced hand arms its
   * placement; a picture opens its own menu, which keeps the locked-background
   * reachability story (a locked picture is invisible to the pointer, so this
   * panel is the only way to reach one).
   */
  function paintSide(): void {
    const cap = (text: string, waiting?: number): HTMLElement =>
      el("div", { className: "mapside-cap" }, el("span", { text }),
        ...(waiting !== undefined && waiting > 0
          ? [el("span", { className: "mapside-waiting", text: `${waiting} waiting` })] : []));
    const row = (label: string, tip: string, onClick: (e: MouseEvent) => void, cls = ""): HTMLElement =>
      el("button", { className: `mapside-row${cls}`, tip, onClick },
        el("span", { className: "mapside-name", text: label }));

    const zoneRows = [
      ...map.zones.map((z) => {
        const r = row(z.gameId, "Show it on the map", () => { surface.select([z.id]); surface.showSelection(); });
        const dot = el("i", { className: "mapside-dot" });
        dot.style.color = `var(--char-${colourIndex(z.gameId)})`;
        r.prepend(dot);
        return r;
      }),
      ...map.undrawn.map((z) => {
        const r = row(z.gameId, "Not drawn yet. Click to trace its outline.", () => trace(z.id, z.gameId), " todo");
        r.append(el("span", { className: "mapside-act", text: "trace" }));
        return r;
      }),
    ];
    const siteRows = [
      ...map.sites.map((site) => {
        const r = row(site.gameId, "Show its pin on the map", () => { surface.select([site.id]); surface.showSelection(); });
        r.prepend(el("i", { className: "mapside-pin" }));
        return r;
      }),
      ...(map.unplaced ?? []).map((hand) => {
        const r = row(hand.gameId, "Not on the map yet. Click, then click where it sits.", () => place(hand.id, hand.gameId), " todo");
        r.append(el("span", { className: "mapside-act", text: "place" }));
        return r;
      }),
    ];
    const pictureRows = map.backgrounds.map((b) =>
      row(`${b.file}${b.locked === true ? " \u00b7 locked" : ""}${b.hidden === true ? " \u00b7 hidden" : ""}`,
        "Everything a picture can do, in its menu.",
        (e) => {
          const at = (e.currentTarget as HTMLElement).getBoundingClientRect();
          backgroundMenu(b, { x: at.left, y: at.bottom + 2 });
        }));

    side.replaceChildren(
      cap("Zones", map.undrawn.length), ...zoneRows,
      cap("Hands", (map.unplaced ?? []).length), ...siteRows,
      ...(pictureRows.length > 0 ? [cap("Pictures"), ...pictureRows] : []),
    );
  }

  /**
   * What a selected pin says about itself: which zone its HAND belongs to, and
   * whether dragging it can change that.
   *
   * The three answers are genuinely different and used to read the same. A hand
   * whose template chooses this group can be moved by dragging. A hand whose
   * template BINDS the group for all its instances cannot, and the reason is not
   * about this hand at all. And a hand with no route to the group has a pin that
   * is a note about where it sits and nothing more, which an author should be
   * told before they try to drag it somewhere meaningful.
   */
  function describeSite(site: SiteShape & { kind: "site" }): string {
    const rule = siteRule.get(site.id);
    const where = site.zone === undefined ? "no zone yet" : (zoneName(site.zone) ?? "a zone");
    // Said FIRST when it applies, because it is the thing the picture is getting
    // wrong: two outlines around one site look like nesting, and zones are tags,
    // so they do not nest. Naming the losers is the point - "also inside" without
    // saying what would leave the author hunting for the other outline.
    // SHORT here, because the strip is one line with an ellipsis and a clipped
    // explanation explains nothing. The full reason is on the site's own rollover
    // (`hoverTip`), which is where this app teaches: the strip states the fact.
    const others = site.alsoInside ?? [];
    const also = others.length === 0 ? ""
      : ` Also inside ${listNames(others)}, which does not count.`;
    if (rule?.rebinds === true) {
      return site.zone === undefined
        ? `${site.title}: ${where}. Drag it into one to bind it.${also}`
        : `${site.title}: in ${where}. Drag it to another to move the hand.${also}`;
    }
    if (rule?.fixedBy !== undefined) {
      return `${site.title}: in ${where}, fixed by the template "${rule.fixedBy}" for every hand it makes.${also}`;
    }
    return `${site.title}: this hand does not use this map's tags, so its pin only marks a spot.${also}`;
  }

  /** "a", "a and b", "a, b and c" - a list an author reads, not a join. */
  function listNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  /** Everything a picture can be told to do, in one place. Reached from its chip
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
      // Fading is what makes a tracing base usable, so it is one click rather
      // than a slider nobody would find: three steps and back to full.
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

  function paintStrip(): void {
    paintSide();
    const chosen = surface.selection();

    // A tool is armed: same rule as a trace, one instruction and a way out. The
    // comment tool shares that grammar rather than inventing a second one.
    const furnitureHint = commentArmed ? "Comment: click where it goes" : furniture?.hint();
    if (furnitureHint !== undefined) {
      strip.replaceChildren(
        el("span", { className: "hint", text: furnitureHint }),
        el("span", { className: "stripgap" }),
        el("button", {
          className: "stripbtn cancel", text: "Cancel", tip: "Abandon this (Esc)",
          onClick: () => { if (commentArmed) disarmComment(); else furniture?.cancel(); },
        }),
      );
      return;
    }

    // Mid-gesture the strip says how to finish and how to get out, and nothing else:
    // a canvas in the middle of a shape is no place for a row of other verbs.
    if (busy !== undefined) {
      strip.replaceChildren(
        el("span", { className: "hint", text: busy.drawing
          ? draft.length === 0
            ? `${busy.label}: click to place the first corner`
            : draft.length < 3
              ? `${busy.label}: ${draft.length} corner${draft.length === 1 ? "" : "s"} so far`
              : `${busy.label}: click the first corner again, or press Enter, to close`
          : `${busy.label}: click where the hand sits` }),
        el("span", { className: "stripgap" }),
        el("button", { className: "stripbtn cancel", text: "Cancel", tip: "Abandon this (Esc)", onClick: () => stopTool() }),
      );
      return;
    }

    const what = chosen.length === 1 ? byId(chosen[0]!) : undefined;
    const said = refused ?? (what === undefined
      ? (chosen.length > 1 ? `${chosen.length} selected` : describe(map))
      : what.kind === "background"
        ? `${what.title}: a picture behind the map. Drag it, or lock it once it is right.`
        : what.kind === "frame"
          ? `${what.title ?? "Frame"}: drag its bar to move it, double-click to rename it`
          : what.kind === "zone"
              ? pickedVertex !== undefined
                ? `${what.title}: corner ${pickedVertex + 1} picked. Delete removes it.`
                : `${what.title}: drag a corner to reshape, a mid-point to add one`
              : describeSite(what));

    const group = groupControl();
    // Three voices, left to right: the verbs as real buttons, the things waiting to
    // be placed as chips (a noun you pick, not a verb), then what is going on. They
    // used to share one voice, which made the strip read as a sentence rather than
    // as a toolbar.
    strip.replaceChildren(
      ...(group ? [group] : []),
      el("div", { className: "striptools" },
        el("button", {
          className: "stripbtn", text: "Zone", tip: "Trace a new zone on the map",
          onClick: () => trace(undefined, "New zone"),
        }),
        el("button", {
          className: "stripbtn", text: "Background",
          tip: "Put a picture behind the map, to place the content on",
          onClick: () => {
            // The camera NOW: the picture is sized against what the author is
            // looking at, and centred on the middle of it.
            const box = stage.getBoundingClientRect();
            const cam = surface.camera();
            actions.addBackground({
              view: { width: box.width, height: box.height },
              scale: cam.scale,
              at: {
                x: (box.width / 2 - cam.x) / cam.scale,
                y: (box.height / 2 - cam.y) / cam.scale,
              },
            });
          },
        }),
        el("button", {
          className: "stripbtn", text: "Frame",
          tip: "Draw a titled frame behind part of the map",
          onClick: () => furniture?.drawFrame(),
        }),
        el("button", {
          className: "stripbtn", text: "Comment",
          tip: "Drop a comment on the map or on a site",
          onClick: () => armComment(),
        }),
      ),
      el("span", { className: "hint", text: said }),
      // The overlay names itself and DATES its evidence, as it does on the node
      // canvas: a map silently wearing an old run is the one way this misleads.
      ...(actions.coverageOn()
        ? [el("span", { className: "hint cover-legend", text: coverageLegend(actions.coverage(), Date.now()) })]
        : []),
      el("span", { className: "stripgap" }),
    );
  }

  // --- the canvas --------------------------------------------------------------
  let tokens = readCanvasTokens();
  const surface: CanvasSurface<MapItem> = mountCanvasSurface<MapItem>({
    host: stage,
    tokens,
    // A map is a place, not a diagram: zones line up with a floor plan, not with a
    // grid of our choosing, so nothing snaps.
    grid: 0,
    draw: (item: MapItem, ctx: DrawContext): Konva.Group => {
      if (item.kind === "background") return drawBackground(item, ctx);
      if (item.kind === "frame") return drawFrame(item, ctx);
      return item.kind === "zone" ? drawZone(item, ctx) : drawSite(item, ctx);
    },
    // Below the label floor the map is shapes and dots with no names on it at
    // all, and a pin is four pixels across. The rollover is how you ask which is
    // which without zooming back in and losing the whole picture.
    hoverTip: (item, scale) => {
      // Overlapping outlines get the full explanation, at any zoom: this is the
      // one thing on the map the picture actively misleads about, so it is worth
      // a rollover of its own rather than a label the eye has to be small to see.
      if (item.kind === "site" && item.alsoInside !== undefined && item.alsoInside.length > 0) {
        const own = item.zone === undefined ? undefined : zoneName(item.zone);
        return own === undefined
          ? `${item.title} sits inside ${listNames(item.alsoInside)}. Zones do not nest: dropping it binds to the frontmost one only.`
          : `${item.title} belongs to ${own}. It also sits inside ${listNames(item.alsoInside)}, which counts for nothing: zones are tags, so they do not nest, and a site belongs to the frontmost zone around it.`;
      }
      if (scale >= LABEL_FLOOR) return undefined;
      return item.title;
    },
    onActivate: (id) => {
      if (furniture?.activate(id) === true) return;
      const item = byId(id);
      if (item?.kind === "zone") actions.openZone(id);
      else if (item?.kind === "site") actions.openHand(id);
    },
    onSelectionChange: () => {
      // A different zone's corners are not this zone's: the pick goes with it.
      pickedVertex = undefined;
      repaint();
      paintStrip();
    },
    // Delete on the canvas means the picked CORNER, when there is one. Zones and
    // hands come off the map from their own menus, where the wording can say what
    // stays behind.
    onDelete: () => {
      const chosen = surface.selection();
      if (furniture !== undefined && furniture.absorbDelete(chosen).length !== chosen.length) return;
      const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;
      if (pickedVertex !== undefined && only?.kind === "zone") removeVertex(only.id, pickedVertex);
    },
    onContext: (id, _world, e) => {
      if (id !== undefined && furniture?.menu(id, e) === true) return;
      const item = id === undefined ? undefined : byId(id);
      // Per-item actions only: adding lives in the strip, where it cannot grow into
      // a list of everything in the project.
      // The wording names what goes and what stays. "Clear its outline" described
      // the mechanism (geometry) rather than the act, and read as though it might
      // delete the zone itself; nothing here ever deletes a tag or a hand.
      if (item?.kind === "site") {
        openContextMenu(e.clientX, e.clientY, [
          { label: `Open ${item.title}`, onClick: () => actions.openHand(item.id) },
          { label: "Remove from the map", danger: true, onClick: () => actions.removeSite(item.id) },
        ]);
        return;
      }
      if (item?.kind === "background") {
        const dto = map.backgrounds.find((b) => b.id === item.id);
        if (dto) backgroundMenu(dto, { x: e.clientX, y: e.clientY });
        return;
      }
      if (item?.kind === "zone") {
        // Drawing-app layering, in a drawing app's words. Only offered where it
        // would do something: on the frontmost zone, "bring to front" is a menu
        // item that does nothing, which is worse than one that is not there.
        const order = map.zones.map((z) => z.id);
        const at = order.indexOf(item.id);
        const canRaise = at >= 0 && at < order.length - 1;
        const canLower = at > 0;
        openContextMenu(e.clientX, e.clientY, [
          { label: `Open ${item.title}`, onClick: () => actions.openZone(item.id) },
          ...(canRaise ? [
            { label: "Bring to front", onClick: () => actions.restackZone(item.id, "front") },
            { label: "Bring forward", onClick: () => actions.restackZone(item.id, "forward") },
          ] : []),
          ...(canLower ? [
            { label: "Send backward", onClick: () => actions.restackZone(item.id, "backward") },
            { label: "Send to back", onClick: () => actions.restackZone(item.id, "back") },
          ] : []),
          { label: "Remove from the map", danger: true, onClick: () => actions.reshapeZone(item.id, []) },
        ]);
      }
    },
    onMove: (rawMoves) => {
      // Furniture first, and it takes its own out of the list: a frame or a
      // sticky is arrangement, so it never reaches the pin rebinding below.
      const moves = furniture?.absorbMoves(rawMoves) ?? rawMoves;
      for (const move of moves) {
        const item = byId(move.id);
        if (item) { item.x = move.x; item.y = move.y; }
      }
      // Zones first: a dropped ZONE writes its new outline. It rebinds nobody (see
      // applyOutline), so the sites that travelled with it keep the hands they had.
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind === "zone") actions.reshapeZone(item.id, worldOutline(item));
      }
      // A dropped PICTURE keeps its new corner. Coalesced, because a drag is one
      // gesture however many frames it took.
      for (const move of moves) {
        const item = byId(move.id);
        if (item?.kind === "background") {
          actions.editBackground(item.id, { x: move.x, y: move.y }, { coalesce: true });
        }
      }
      // Then the PINS, which is the move the map exists for. Only where they now
      // are: main works out which zone that is and which hands it rebinds, and
      // says so through `rebound` (below), so the canvas and the shard cannot
      // come to different conclusions about the same drop.
      const dropped = moves
        .map((m) => byId(m.id))
        .filter((i): i is SiteShape & { kind: "site" } => i?.kind === "site");
      if (dropped.length > 0) {
        refused = undefined;
        // A site whose group is fixed by its template will not move zone whatever
        // it is dropped on, so say that now rather than leaving the author to
        // notice that nothing happened.
        for (const site of dropped) {
          const rule = siteRule.get(site.id);
          if (rule?.fixedBy !== undefined) {
            refused = `${site.title} goes where "${rule.fixedBy}" says: every hand from that template shares one zone.`;
          }
        }
        actions.movedSites(dropped.map((site) => ({ id: site.id, ...sitePoint(site) })));
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

  /** Take a corner out, if the shape can spare it. A triangle cannot: refusing
   *  beats leaving a zone that cannot be drawn. */
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
   * vertex drag repaints the preview and nothing else: doing both was why a drag
   * stopped dead after a few pixels.
   */
  function repaint(): void {
    paintNames();
    paintHandlesNow();
  }

  function paintNames(): void {
    surface.setForeground((layer, scale, at) => {
      paintZoneLabels(layer, scale, tokens, map.zones, (id) => {
        const item = at(id);
        return item?.kind === "zone" ? item : undefined;
      });
      if (draft.length > 0) paintDraft(layer, scale, tokens, draft, pointer);
      // A vertex mid-drag: the shape as it WOULD be, drawn here rather than by
      // rebuilding the zone, so the handle in the hand survives the frame.
      if (preview) paintDraft(layer, scale, tokens, preview.polygon, undefined);
      // A frame being dragged out: the rectangle it would be.
      const band = furniture?.draft();
      if (band) {
        layer.add(new Konva.Rect({
          x: band.x, y: band.y, width: band.w, height: band.h,
          stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale],
          listening: false,
        }));
      }
      // A picture mid-scale, for the same reason: the rectangle it would have.
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
    // Handles on exactly ONE selected thing: two shapes' worth would be ambiguous
    // to grab and would not say which they belonged to.
    const chosen = surface.selection();
    const only = chosen.length === 1 ? byId(chosen[0]!) : undefined;

    // A selected PICTURE gets corner handles, which scale it proportionally. It
    // can only be selected when unlocked, so this never fights a tracing base.
    if (busy === undefined && only?.kind === "background") {
      const picture = only;
      surface.setChrome((layer, scale) => {
        paintScaleHandles(layer, scale, tokens,
          { x: picture.x, y: picture.y, width: picture.width, height: picture.height }, {
            preview: (rect) => {
              scaling = rect === undefined ? undefined : { id: picture.id, rect };
              // Names and the preview only: rebuilding the chrome here would
              // destroy the handle being dragged.
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
      // The zone's committed shape: the handle being dragged moves itself, and the
      // preview of where it is going is drawn in the foreground.
      paintHandles(layer, scale, tokens, worldOutline(zone), {
        previewVertex: (index, to) => {
          preview = to === undefined ? undefined : { id: zone.id, polygon: withVertexAt(worldOutline(zone), index, to) };
          // Names and the preview shape ONLY: rebuilding the handles here would
          // destroy the one being dragged.
          paintNames();
        },
        moveVertex: (index, to) => applyOutline(zone.id, withVertexAt(worldOutline(zone), index, to)),
        insertVertex: (index, at) => {
          applyOutline(zone.id, withVertexAfter(worldOutline(zone), index, at));
          // The new corner is the one you just asked for, so it is the one picked
          // out: Delete right after inserting undoes the insert.
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
   *
   * `itemAt` answers with SITES only. A marker dropped on a zone stays on the
   * canvas rather than following the zone: a zone is a traced area, its outline
   * is reshaped for cartographic reasons that have nothing to do with what the
   * comment says, and "this corner of the docks is thin" is about the place.
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


  /**
   * Open a marker's thread from OUTSIDE the canvas: the Review Feedback walk
   * stepping onto a comment that lives here.
   *
   * A marker is a Konva shape, so it cannot be reached the way the walk reaches
   * a document's topline bubble. It is centred first and its popover hangs off a
   * proxy at its point, which is the whole reason a comment was dropped on a
   * canvas rather than filed against the container: the place IS the subject.
   */
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

  surface.setItems(items);
  repaint();
  const remembered = recallCamera(cameraKey);
  if (remembered) surface.setCamera(remembered);
  else surface.fitAll();
  paintStrip();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); repaint(); });
  // A picture finishing its load is the one repaint nobody asked for: the first
  // paint of a new background is a placeholder, and this is the arrival.
  const unwatchImages = onImageReady(() => { surface.setItems(items); repaint(); });

  return {
    repaintMarkers() { surface.repaintMarkers(); },
    openMarker,
    refreshCoverage() { dressCoverage(); surface.setItems(items); paintStrip(); },
    rebound(changes) {
      if (changes.length === 0) return;
      for (const change of changes) {
        const site = byId(change.id);
        if (site?.kind !== "site") continue;
        site.zone = change.zone ?? undefined;
        site.zoneName = change.zone === null ? undefined : zoneName(change.zone);
        site.unbound = change.zone === null;
      }
      surface.setItems(items);
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

/** What the strip says with nothing selected: the state of the map, quietly. */
function describe(map: BoxMapDto): string {
  if (map.zones.length === 0) return "No zones yet: add one and trace its outline.";
  const zones = `${map.zones.length} zone${map.zones.length === 1 ? "" : "s"}`;
  const sites = map.sites.length === 0 ? "no hands pinned" : `${map.sites.length} pinned`;
  return `${zones}, ${sites}.`;
}
