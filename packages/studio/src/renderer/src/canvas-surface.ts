// ---------------------------------------------------------------------------
// canvas-surface: the behaviour every canvas in Storyletter shares, so the node
// canvas and the map feel like one tool (design/graphical-views.md section 1.1).
// Pan, zoom, fit-to-contents, marquee select, multi-drag, snapping, the
// selection model, the keyboard map, and the themed grid.
//
// The surface owns the camera and the interaction; the CALLER owns the drawing.
// You hand it items and a `draw` that turns one item into a Konva.Group, and it
// places, hit-tests, selects and moves them. It knows nothing about cards.
//
// Conventions carried from the old system, which paid for them once already
// (../storylets-old/docs/developer/storymap-canvas.md section 2):
//   - chrome scales INVERSELY with zoom, so rings and handles stay a constant
//     size on screen rather than ballooning as you zoom in
//   - move by dragging an item's BODY; a separate centre handle was tried there
//     and removed
//   - Delete / Escape mean delete-the-selection and cancel-or-deselect
//
// The camera is driven by hand rather than by Konva's stage drag, because the
// two want different things: stage drag competes with the marquee for the left
// button, and its dragmove bubbles out of item drags into the camera.
//
// Extraction candidate for @wildwinter/app-shell once a second app wants it,
// which is the family's recorded order: Storyletter proves it, Patterpad
// follows. Patterpad has no canvas today, so this is the one piece of the
// graphical views with no Patterpad precedent to adopt.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { hideTip, tipAt } from "@wildwinter/app-shell";
import { mountCanvasControls, type CanvasControls } from "./canvas-controls.js";
import type { CanvasTokens } from "./canvas-tokens.js";

/** The minimum a surface needs to know about a thing it draws. */
export interface CanvasItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The item's own corner radius in world units, if it has rounded corners. The
   *  selection ring adds its offset to this so the two curves stay concentric;
   *  a ring with its own fixed radius leaves visible gaps at the corners of a
   *  rounded card. Omit for square corners. */
  cornerRadius?: number;
  /**
   * Invisible to the pointer: not selectable, not draggable, clicks pass through
   * to whatever is above (or to the canvas itself).
   *
   * The diagram-tool lock, and what a background needs once it is placed: a
   * tracing base under everything must not answer for a click meant for a zone.
   * A locked item is still DRAWN and still framed by a fit; it simply is not a
   * target, which is the difference between locking and hiding.
   */
  locked?: boolean;
  /** The item's real edge, relative to its own origin, when it is not a
   *  rectangle. The surface still positions and hit-tests by the box above (and
   *  Konva hit-tests the drawn shape itself, so a click lands where it looks like
   *  it lands), but the selection ring follows THIS. A map zone needs it: a ring
   *  round the bounding box of an L-shaped corridor encloses the courtyard it
   *  wraps around, which belongs to another zone. */
  outline?: { x: number; y: number }[];
  /**
   * The item's edge is a CIRCLE of this radius in SCREEN pixels, centred in its
   * box. Takes precedence over `outline`, which cannot express it.
   *
   * `outline` is world units and fixed, which is right for a zone polygon and
   * wrong for a marker: a site draws its disc at a constant size on screen, so a
   * world-space edge would match at exactly one zoom and be wrong at every
   * other. The radius is the same constant the marker draws itself from, so the
   * ring cannot drift from the disc.
   */
  discRadius?: number;
}

export interface DrawContext {
  tokens: CanvasTokens;
  /** The current zoom, for a draw that wants to abbreviate when small. */
  scale: number;
}
// Deliberately NO `selected` here. The surface owns how a selection looks (its
// ring, drawn in the overlay), for two reasons. One is taste: a face that also
// restyles its border ends up as one heavy band rather than as a selection. The
// other is mechanical, and it bit hard - if `draw` could respond to selection
// then selecting would have to rebuild the item, and rebuilding an item destroys
// the Konva group the pointer is holding, so pressing an unselected card and
// dragging in one gesture did nothing at all. Selection now repaints the overlay
// and nothing else.

export interface CanvasSurfaceOptions<T extends CanvasItem> {
  host: HTMLElement;
  tokens: CanvasTokens;
  /** Turn one item into a group drawn at the ORIGIN: the surface positions it.
   *  Called again when the items, the zoom or the theme change. NOT on selection
   *  (see DrawContext), and never during a drag. */
  draw: (item: T, ctx: DrawContext) => Konva.Group;
  /** Snap step in world units. 0 disables the grid and snapping. */
  grid?: number;
  /** World-space room a caller's BACKDROP needs around the items when framing: a
   *  caption band, a legend, a title. A fit measures items, because items are all
   *  the surface knows about, so anything drawn outside them would otherwise be
   *  framed straight off the top of the pane. */
  fitMargin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** A drag finished: the caller persists. Only items that moved are reported. */
  onMove?: (moves: { id: string; x: number; y: number }[]) => void;
  onSelectionChange?: (ids: string[]) => void;
  /** Double-click, which everywhere in this app means "take me to the thing". */
  onActivate?: (id: string) => void;
  onDelete?: (ids: string[]) => void;
  /** A plain letter key the surface does not claim, lowercased. The guard against
   *  firing while the author is typing lives here, so every caller gets it. */
  onKey?: (key: string) => void;
  /** Right-click: `id` is the item under the pointer, or undefined for empty
   *  canvas, and `world` is where the click landed in canvas coordinates so a
   *  caller can put something THERE. The surface has no menu of its own; every
   *  canvas in this app already has a DOM context menu and reuses it. */
  onContext?: (id: string | undefined, world: { x: number; y: number }, e: MouseEvent) => void;
  /** Camera changed: for a caller with its own zoom readout or minimap. */
  onCamera?: (scale: number) => void;
  /** A drag began. Distinct from `onHover(undefined)` on purpose: hover chrome
   *  usually fades on a grace period so the pointer can travel onto it, but a drag
   *  wants it gone THIS INSTANT. */
  onDragStart?: () => void;
  /** The pointer moved onto or off an item, by what is DRAWN there (Konva's hit
   *  graph, so a rollover and a click never disagree). Reported WITHOUT any
   *  repaint, deliberately: a caller that wants hover chrome should
   *  draw it in the DOM above the canvas, because repainting the items on hover
   *  would destroy the group under the pointer and break the very next drag. */
  onHover?: (id: string | undefined) => void;
  /** What to say about the item under the pointer, in a themed tooltip anchored
   *  to it, or undefined for nothing.
   *
   *  For the label a zoom has taken away. Every canvas here abbreviates as it
   *  shrinks (a card loses its title below 34%, a zone and a pin lose their names
   *  below 35%), which is right - text scaled to two pixels is worse than no text
   *  - but it leaves a board of anonymous shapes with no way to ask which is
   *  which short of zooming back in. The tip is DOM, so it holds its size however
   *  far out the camera is: that is the whole point of it.
   *
   *  Handed the scale so a caller can answer only when the face has actually
   *  given the label up, rather than shadowing text that is right there. */
  hoverTip?: (item: T, scale: number) => string | undefined;
}

/** Draws behind the items. `at` returns an item with its live coordinates: the
 *  same object shape the caller handed in, so width, height and anything else it
 *  carries are still there, but x and y are wherever the thing is RIGHT NOW. */
export type BackdropPainter<T extends CanvasItem> =
  (layer: Konva.Container, scale: number, at: (id: string) => T | undefined) => void;

/**
 * A TOOL takes over the left button: while one is set, a click means "here"
 * rather than "select that", and nothing on the canvas can be selected, dragged
 * or marqueed.
 *
 * That is what makes placing possible at all. Without it, a click inside a zone
 * hits the zone (which is what a click on a shape should do), so a pin could only
 * ever be dropped on empty ground and then dragged into place. Panning still works
 * throughout, because a tool is not a reason to lose your way around the canvas.
 */
export interface CanvasTool {
  /** The cursor while it is active. */
  cursor?: string;
  /** A left click, in world coordinates. */
  onClick: (world: { x: number; y: number }) => void;
  /** The pointer moved, in world coordinates: for a rubber band. */
  onMove?: (world: { x: number; y: number }) => void;
  /** Enter: finish (close the polygon). */
  onCommit?: () => void;
  /** Escape, or the tool being replaced: abandon. */
  onCancel?: () => void;
}

/** Where the camera is looking: the stage offset and the zoom. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasSurface<T extends CanvasItem> {
  /** Replace the items. The selection survives for ids that still exist. */
  setItems: (items: T[]) => void;
  /** Repaint in a new theme. */
  setTokens: (tokens: CanvasTokens) => void;
  /** Draw beneath the items (edges, a map image). Called on every camera change
   *  AND on every frame of a drag, with the current scale (so a caller can hold
   *  its line widths constant on screen) and a lookup that returns items at their
   *  LIVE positions. Use that lookup rather than your own model: mid-drag your
   *  model is still at the old coordinates, and edges that catch up only on drop
   *  look broken. */
  setBackdrop: (paint: BackdropPainter<T> | undefined) => void;
  /** Draw ABOVE the items and below the selection, with the same painter contract
   *  as the backdrop. For what a later item must not be able to cover: the map's
   *  zone names, because zones nest. */
  setForeground: (paint: BackdropPainter<T> | undefined) => void;
  /** Draw INTERACTIVE chrome above everything: the map's vertex handles. Unlike the
   *  foreground this layer listens, so a caller's Konva nodes get their own
   *  pointer events (set `cancelBubble` on them, as handles must, so a handle drag
   *  is not also a canvas gesture). Repainted with the camera, so a caller's
   *  handles can hold a constant size on screen. */
  setChrome: (paint: BackdropPainter<T> | undefined) => void;
  /**
   * Draw interactive MARKERS: comment markers, and anything else that is about
   * the canvas rather than part of it.
   *
   * The same contract as `setChrome` and the same Konva layer, in a sibling
   * GROUP, so the two repaint independently: a marker drag must not rebuild the
   * map's vertex handles, and dragging a vertex must not make markers flicker.
   *
   * A group rather than a layer of its own on purpose. Konva warns above six
   * layers and this file already has six; z-order inside a layer is child order,
   * and `listening` is per-node, so a group buys the separation at no cost.
   * See design/annotation.md, "The layer budget".
   */
  setMarkers: (paint: BackdropPainter<T> | undefined) => void;
  /** Repaint just the markers: after posting, moving or resolving one. */
  repaintMarkers: () => void;
  /** Take over the left button with a tool, or clear it with undefined. Setting a
   *  tool cancels the one it replaces. */
  setTool: (tool: CanvasTool | undefined) => void;
  selection: () => string[];
  select: (ids: string[]) => void;
  /** Frame everything: the "I am lost" command. */
  fitAll: () => void;
  /** Bring the selection into view and centre it, keeping the author's zoom if
   *  the whole selection already fits at it. Does nothing with no selection. */
  showSelection: () => void;
  /** Make sure these items are visible, and do NOTHING if they already are.
   *
   *  For the aftermath of a command rather than for a request to look somewhere:
   *  an author who asked to arrange cards did not ask to be moved, so the camera
   *  is only allowed to intervene when the result would otherwise be off-screen. */
  revealIfOffscreen: (ids: string[]) => void;
  /** Back to 1:1, about the middle of the view. A no-op at 1:1 already. */
  actualSize: () => void;
  zoomBy: (factor: number) => void;
  scale: () => number;
  /** Where an item is on SCREEN right now, for a caller placing DOM chrome over
   *  the canvas. Undefined when the item is not known. */
  screenRect: (id: string) => { x: number; y: number; width: number; height: number } | undefined;
  /** A canvas point in the container's own pixels. For hanging a DOM affordance
   *  off a place rather than off an item, which `screenRect` cannot do because
   *  there is no item there. */
  toScreen: (at: { x: number; y: number }) => { x: number; y: number };
  /** Read the camera, to put it back later. A view that is torn down and rebuilt
   *  (switching away from a canvas and back, an undo, any re-render) must not
   *  throw away where the author was looking. */
  camera: () => Camera;
  setCamera: (camera: Camera) => void;
  /** Put an item in the middle without changing the zoom. */
  centreOn: (id: string) => void;
  /** The same for a PLACE rather than an item: what the feedback walk needs to
   *  arrive at a marker floating on empty canvas, where there is no item to name. */
  centreAt: (at: { x: number; y: number }) => void;
  resize: () => void;
  destroy: () => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const FIT_PADDING = 48;
/** Below this, a grid line every few pixels is noise rather than orientation. */
const GRID_MIN_PX = 8;

export function mountCanvasSurface<T extends CanvasItem>(opts: CanvasSurfaceOptions<T>): CanvasSurface<T> {
  let tokens = opts.tokens;
  const snap = opts.grid ?? 0;
  const opts_fitMargin = {
    top: opts.fitMargin?.top ?? 0, right: opts.fitMargin?.right ?? 0,
    bottom: opts.fitMargin?.bottom ?? 0, left: opts.fitMargin?.left ?? 0,
  };
  let items: T[] = [];
  let selected = new Set<string>();
  let backdrop: BackdropPainter<T> | undefined;
  let foreground: BackdropPainter<T> | undefined;
  let chrome: BackdropPainter<T> | undefined;
  let markers: BackdropPainter<T> | undefined;
  let tool: CanvasTool | undefined;

  const stage = new Konva.Stage({
    // Konva's types ask for a div; it only ever appends a child, so any element
    // does. Kept as HTMLElement in our API so callers need no cast of their own.
    container: opts.host as HTMLDivElement,
    width: Math.max(1, opts.host.clientWidth),
    height: Math.max(1, opts.host.clientHeight),
  });

  // THREE layers, and the reason for exactly three is worth reading before adding
  // a fourth. A Konva layer is its own <canvas>: the only thing that buys you is
  // INDEPENDENT REDRAW, and Konva warns above five because each one costs memory
  // and a compositing pass. This surface had six and warned on every mount.
  //
  // Two earn a canvas of their own:
  //   - the GRID, which redraws on a camera change and nothing else.
  //   - the BACKDROP, because a 10MB site plan must not be repainted every time a
  //     card moves a pixel.
  // Everything else repaints together, so it is one layer with five groups. Z-order
  // inside a layer is just child order and `listening` is per-node, so the bands
  // are exactly what they were.
  const gridLayer = new Konva.Layer({ listening: false });
  const backdropLayer = new Konva.Layer({ listening: false });
  const mainLayer = new Konva.Layer();
  stage.add(gridLayer, backdropLayer, mainLayer);

  /** The items themselves. Listens, and is turned off wholesale when a document
   *  somebody else holds is on screen. */
  const contentGroup = new Konva.Group();
  /** Above the items, below the selection: for anything a later item must not be
   *  able to cover. The map's zone names live here, because zones NEST (a square
   *  inside a district, a room inside a wing) and a name drawn inside its own
   *  shape disappears under whatever is drawn on top of it. */
  const foreGroup = new Konva.Group({ listening: false });
  /** Selection rings and the marquee: chrome that must never be zoomed into
   *  illegibility. */
  const overlayGroup = new Konva.Group({ listening: false });
  /** Interactive chrome (the map's vertex handles): grabbable, so it listens. */
  const chromeGroup = new Konva.Group();
  /** Comment markers, which are about the canvas rather than part of it. Last, so
   *  a marker sits above a handle rather than under it. */
  const markerGroup = new Konva.Group();
  mainLayer.add(contentGroup, foreGroup, overlayGroup, chromeGroup, markerGroup);

  /** Is this node inside that group? For telling a press on chrome from a press on
   *  an item, now that both live on one layer and `getLayer()` can no longer
   *  answer it. */
  const inside = (node: Konva.Node | null, group: Konva.Group): boolean => {
    for (let n: Konva.Node | null = node; n; n = n.getParent()) if (n === group) return true;
    return false;
  };

  // The navigation cluster, AFTER the stage: Konva empties its container when it
  // builds one (Stage.js, `container.innerHTML = ''`), so anything added first is
  // silently wiped. Same trap the open chip fell into.
  let controls: CanvasControls | undefined;

  /** Tell the cluster what is available: the zoom it should show, and which of
   *  its buttons would do nothing if pressed. */
  function refreshControls(): void {
    controls?.update({
      scale: stage.scaleX(), hasItems: items.length > 0, hasSelection: selected.size > 0,
      min: MIN_SCALE, max: MAX_SCALE,
    });
  }

  /** The world rectangle currently on screen. */
  function visibleWorldRect(): { x: number; y: number; width: number; height: number } {
    const scale = stage.scaleX();
    return {
      x: -stage.x() / scale,
      y: -stage.y() / scale,
      width: stage.width() / scale,
      height: stage.height() / scale,
    };
  }

  function worldPointer(): { x: number; y: number } {
    const p = stage.getPointerPosition() ?? { x: 0, y: 0 };
    const scale = stage.scaleX();
    return { x: (p.x - stage.x()) / scale, y: (p.y - stage.y()) / scale };
  }

  // --- the grid ---------------------------------------------------------------
  // Drawn across the visible world rect only, so panning a long way costs
  // nothing. Two levels, both of which fade out when they stop reading as a
  // grid: minor lines go first, then the majors.
  const grid = new Konva.Shape({
    listening: false,
    sceneFunc: (ctx) => {
      if (snap <= 0) return;
      const scale = stage.scaleX();
      const view = visibleWorldRect();
      const major = snap * 5;

      const rule = (step: number, colour: string, skipMajor: boolean): void => {
        if (step * scale < GRID_MIN_PX) return;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1 / scale;          // one screen pixel at any zoom
        const first = (v: number): number => Math.floor(v / step) * step;
        ctx.beginPath();
        for (let x = first(view.x); x <= view.x + view.width; x += step) {
          if (skipMajor && isMultiple(x, major)) continue;
          ctx.moveTo(x, view.y);
          ctx.lineTo(x, view.y + view.height);
        }
        for (let y = first(view.y); y <= view.y + view.height; y += step) {
          if (skipMajor && isMultiple(y, major)) continue;
          ctx.moveTo(view.x, y);
          ctx.lineTo(view.x + view.width, y);
        }
        ctx.stroke();
      };

      rule(snap, tokens.lineSoft, true);
      rule(major, tokens.line, false);
    },
  });
  gridLayer.add(grid);

  function isMultiple(v: number, of: number): boolean {
    const r = Math.abs(v % of);
    return r < 1e-6 || of - r < 1e-6;
  }

  // --- items ------------------------------------------------------------------
  const groups = new Map<string, Konva.Group>();

  function paintItems(): void {
    // NEVER rebuild the items under a live drag. A repaint destroys every group
    // and builds new ones, which pulls the node out from under Konva's drag: the
    // card stops following the pointer and the drag ends up doing nothing at all,
    // silently. A zoom, a window resize or a theme change mid-drag would all do
    // it. The repaint waits for the drop instead.
    if (dragStart || pressed) { repaintAfterDrag = true; return; }
    contentGroup.destroyChildren();
    groups.clear();
    const scale = stage.scaleX();
    for (const item of items) {
      const group = opts.draw(item, { tokens, scale });
      group.position({ x: item.x, y: item.y });
      group.id(item.id);
      if (item.locked === true) {
        // Not a target: no drag, and out of the hit graph entirely so a press
        // reaches whatever the author actually meant.
        group.listening(false);
      } else {
        group.draggable(true);
        wireItem(group, item);
      }
      contentGroup.add(group);
      groups.set(item.id, group);
    }
    mainLayer.batchDraw();
    paintOverlay();
  }

  /** The selection rings, and the marquee. In their own layer so their strokes
   *  stay one width on screen and nothing drawn later can occlude them. Read
   *  from the live groups, not from `items`, so a drag in flight is truthful. */
  function paintOverlay(): void {
    overlayGroup.destroyChildren();
    const scale = stage.scaleX();
    // The ring is drawn ON the item's boundary, not outside it: a stroke centred
    // on the edge covers the item's own border and extends a hair beyond, which
    // is exactly what `.scard.sel` does in the DOM (the border recolours, plus
    // 1px outside). Any offset at all leaves a sliver of board showing between
    // the ring and the card, and a gap reads as broken rather than as selected.
    const ring = 2 / scale;
    // Two strokes per ring: a wider one in the canvas ground colour underneath
    // the accent. On a plain canvas the understroke vanishes into the ground;
    // over a background picture it is what keeps the ring legible, because an
    // accent-only stroke over busy art has no contrast to count on.
    const halo = ring * 2.6;
    const strokes: [string, number][] = [[tokens.bg, halo], [tokens.accent, ring]];
    for (const id of selected) {
      const group = groups.get(id);
      const item = items.find((i) => i.id === id);
      if (!group || !item) continue;
      // An item that is not a rectangle says so, and its ring follows its own
      // edge. A ring round the bounding box of a zone polygon would enclose
      // whatever else happens to fall in that box, which on a map (an L-shaped
      // corridor wrapped round a courtyard) is somebody else's zone.
      // A marker whose size is CHROME: its edge is a disc that keeps its size on
      // screen, so the ring is computed per draw rather than carried as points.
      if (item.discRadius !== undefined) {
        for (const [stroke, strokeWidth] of strokes) {
          overlayGroup.add(new Konva.Circle({
            x: group.x() + item.width / 2, y: group.y() + item.height / 2,
            radius: item.discRadius / scale,
            stroke, strokeWidth, listening: false,
          }));
        }
        continue;
      }
      if (item.outline) {
        const points: number[] = [];
        for (const p of item.outline) points.push(group.x() + p.x, group.y() + p.y);
        for (const [stroke, strokeWidth] of strokes) {
          overlayGroup.add(new Konva.Line({
            points, closed: true,
            stroke, strokeWidth, listening: false,
          }));
        }
        continue;
      }
      for (const [stroke, strokeWidth] of strokes) {
        overlayGroup.add(new Konva.Rect({
          x: group.x(), y: group.y(),
          width: item.width, height: item.height,
          stroke, strokeWidth,
          // Concentric by construction now that the paths coincide.
          cornerRadius: item.cornerRadius ?? 0,
          listening: false,
        }));
      }
    }
    if (marqueeFrom && marqueeTo) {
      const box = boxBetween(marqueeFrom, marqueeTo);
      overlayGroup.add(new Konva.Rect({
        ...box, fill: tokens.accentSoft, stroke: tokens.accent,
        strokeWidth: 1 / scale, listening: false,
      }));
    }
    mainLayer.batchDraw();
  }

  function setSelection(ids: string[]): void {
    const next = new Set(ids.filter((id) => items.some((i) => i.id === id && i.locked !== true)));
    const same = next.size === selected.size && [...next].every((id) => selected.has(id));
    selected = next;
    // The OVERLAY only: see the note on DrawContext. Rebuilding the items here
    // would destroy the group under the pointer, and selecting a card is the one
    // thing that happens on the way into a drag.
    paintOverlay();
    refreshControls();
    if (!same) opts.onSelectionChange?.([...selected]);
  }

  /** The window two left clicks have to fall inside to mean "open this". Konva's
   *  own default, kept so the canvas agrees with the rest of the app. */
  const DOUBLE_CLICK_MS = 400;
  /** The last left click on an item, for the double-click count above. Cleared once
   *  it has been used, so three clicks are not two double clicks. */
  let lastLeftUp: { id: string; at: number } | undefined;

  // --- dragging ---------------------------------------------------------------
  // Dragging one of several selected items moves them all: the selection is the
  // unit of work.
  let dragStart: Map<string, { x: number; y: number }> | undefined;
  /** A repaint that arrived mid-gesture and has to wait for the pointer to lift. */
  let repaintAfterDrag = false;
  /** An item is under a held pointer. A drag has not necessarily started yet -
   *  Konva only begins one on the first move past its threshold - but a rebuild
   *  between the press and that first move loses the node just as thoroughly, so
   *  the whole press is protected, not just the drag. */
  let pressed = false;

  function wireItem(group: Konva.Group, item: T): void {
    group.on("mousedown touchstart", (e) => {
      // Only the LEFT button is the item's: middle and right belong to the camera
      // (pan) and the menu, so they bubble to the stage. Checking for button 2
      // alone left middle-drag dead whenever it happened to start over a card.
      if (e.evt instanceof MouseEvent && e.evt.button !== 0) return;
      e.cancelBubble = true;                 // never a camera pan or a marquee
      pressed = true;
      const evt = e.evt;
      const additive = evt instanceof MouseEvent && (evt.shiftKey || evt.metaKey || evt.ctrlKey);
      if (additive) {
        const next = new Set(selected);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        setSelection([...next]);
      } else if (!selected.has(item.id)) {
        setSelection([item.id]);
      }
    });

    group.on("dragstart", () => {
      // Everything that will move, remembered, so one dragged group can apply
      // its delta to the whole selection.
      dragStart = new Map();
      for (const id of selected.size > 0 ? selected : [item.id]) {
        const g = groups.get(id);
        if (g) dragStart.set(id, { x: g.x(), y: g.y() });
      }
      if (!dragStart.has(item.id)) dragStart.set(item.id, { x: group.x(), y: group.y() });
      // What is moving comes to the front, or it slides underneath whatever
      // happens to be later in the list and the drag looks broken.
      for (const id of dragStart.keys()) groups.get(id)?.moveToTop();
      // Hover chrome goes NOW, from the drag itself rather than from the next
      // mousemove: Konva bails out of its own pointer handling while a drag is
      // running, so the mousemove that would have cleared it never arrives, and
      // the chip hung in mid-air until the card was dropped. Nobody needs an
      // Open button while they are moving something anyway.
      clearHover();
      hideTip();
      opts.onDragStart?.();
    });

    group.on("dragmove", (e) => {
      e.cancelBubble = true;
      if (!dragStart) return;
      // The drag itself is FREE: it follows the pointer exactly. Snapping every
      // frame makes a drag feel clunky and unresponsive, because the card lags
      // the hand and then jumps. The grid is applied once, on release.
      const from = dragStart.get(item.id)!;
      const dx = group.x() - from.x;
      const dy = group.y() - from.y;
      for (const [id, origin] of dragStart) {
        if (id === item.id) continue;
        groups.get(id)?.position({ x: origin.x + dx, y: origin.y + dy });
      }
      paintOverlay();
      // Edges follow the card as it moves. Letting them snap into place after the
      // drop looks broken, and the backdrop reads live positions, so this is the
      // whole cost of it.
      repaintBackdrop();
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      // Now the grid bites, once. The DRAGGED item is what snaps, and everything
      // else moves by that same delta, so a selection keeps its internal spacing
      // instead of collapsing onto the grid one item at a time.
      const from = dragStart?.get(item.id);
      let dx = group.x() - (from?.x ?? group.x());
      let dy = group.y() - (from?.y ?? group.y());
      if (snap > 0 && from) {
        dx = Math.round((from.x + dx) / snap) * snap - from.x;
        dy = Math.round((from.y + dy) / snap) * snap - from.y;
      }
      const moves: { id: string; x: number; y: number }[] = [];
      for (const [id, origin] of dragStart ?? []) {
        const g = groups.get(id);
        if (!g) continue;
        const to = { x: origin.x + dx, y: origin.y + dy };
        g.position(to);
        if (to.x !== origin.x || to.y !== origin.y) moves.push({ id, ...to });
        const it = items.find((i) => i.id === id);
        if (it) { it.x = to.x; it.y = to.y; }
      }
      dragStart = undefined;
      pressed = false;
      mainLayer.batchDraw();
      if (repaintAfterDrag) { repaintAfterDrag = false; paintItems(); }
      paintOverlay();
      repaintBackdrop();
      if (moves.length > 0) opts.onMove?.(moves);
    });

    // Opening a thing is TWO LEFT CLICKS on it, counted here rather than by Konva.
    //
    // Konva's own dblclick fires on any two clicks inside its window whatever
    // buttons they used, so the ordinary sequence "click a zone to select it, then
    // right-click for its menu" completed a double click and navigated away from
    // the map before the menu could be read. Touch keeps Konva's dbltap, which has
    // no buttons to confuse.
    group.on("mouseup", (e) => {
      if (!(e.evt instanceof MouseEvent) || e.evt.button !== 0) return;
      const now = e.evt.timeStamp;
      const again = lastLeftUp !== undefined && lastLeftUp.id === item.id && now - lastLeftUp.at < DOUBLE_CLICK_MS;
      lastLeftUp = again ? undefined : { id: item.id, at: now };
      if (again) {
        e.cancelBubble = true;
        opts.onActivate?.(item.id);
      }
    });
    group.on("dbltap", (e) => {
      e.cancelBubble = true;
      opts.onActivate?.(item.id);
    });
  }

  // --- marquee ----------------------------------------------------------------
  // Plain left drag on empty space, as in every node editor and every drawing
  // tool. Panning is deliberately NOT on the left button (see the camera below).
  let marqueeFrom: { x: number; y: number } | undefined;
  let marqueeTo: { x: number; y: number } | undefined;
  let marqueeAdditive = false;

  function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
    };
  }

  // --- camera -----------------------------------------------------------------
  // Gestures follow the platform rather than Unreal Blueprints, which the node
  // view otherwise takes as its model (design/graphical-views.md section 1.3):
  // Blueprints zooms on a plain wheel, but on a trackpad a two-finger scroll IS
  // a plain wheel, and an author swiping two fingers expects the content to
  // move. So: scroll pans, pinch or cmd-scroll zooms (both arrive as
  // ctrl/meta+wheel), and SHIFT-scroll pans horizontally, which is the one
  // convention a plain mouse cannot live without: a wheel has no sideways axis, so
  // without it half the canvas is unreachable.
  //
  // Panning by drag has three routes, none of them the left button: space-drag,
  // middle-drag, and RIGHT-drag. Right-drag is Blueprints' own answer and it is
  // the only one a mouse user can do one-handed with no modifier. The left button
  // keeps the marquee, as it does in Figma (and in Miro's select mode): pan has
  // three ways in, the marquee has one, so the marquee is what a swap would cost.
  //
  // Right-drag and the right-click menu coexist by taking the menu off the native
  // event: on macOS `contextmenu` fires on mouse DOWN, so a right-drag would open
  // the menu before the pointer moved. We preventDefault it always and open our
  // own menu from the right mouse UP, when we know whether it was a click or a
  // drag. (Blueprints does the same on Windows, where the event happens to arrive
  // on release anyway.)
  /** The last press landed on the chrome layer (a vertex handle), so the canvas
   *  keeps its hands off this gesture. */
  let pressedChrome = false;
  let panning: { pointer: { x: number; y: number }; origin: { x: number; y: number }; button: number } | undefined;
  let panMoved = false;
  let spaceHeld = false;

  stage.on("mousedown", (e) => {
    const evt = e.evt;
    if (!(evt instanceof MouseEvent)) return;
    // Whether this press landed on CHROME, recorded now rather than read back at
    // the mouseup. A handle's own handler may repaint the chrome layer (picking a
    // corner out does), which destroys the very node that was pressed, so by the
    // time the button comes up the target is whatever sits underneath.
    pressedChrome = inside(e.target, chromeGroup) || inside(e.target, markerGroup);
    // EVERY press starts a fresh gesture, so the "was that a pan?" flag is
    // cleared here rather than only where a pan begins.
    //
    // It used to be reset inside the pan branch below, and `endGesture` never
    // touched it, so after one pan it stayed true for the rest of the canvas's
    // life. The next tool click read it, concluded the gesture had been a pan,
    // and silently dropped the placement: arm Comment anywhere you had already
    // panned to, click, and nothing happened, for ever. Reported from use, and
    // it took a live repro to see it because a synthetic click that never panned
    // first works perfectly.
    //
    // NOT in `endGesture`: the tool's mouseup reads this flag and `endGesture`
    // runs before it (registered earlier), so clearing there would also let a
    // space-drag pan finish by dropping a comment where it stopped.
    panMoved = false;
    // A pan gesture works ANYWHERE, over an item as much as over empty board: the
    // camera is not the item's business, and a right-drag that stopped working
    // because it happened to start on a card would be a mystery to its author.
    if (evt.button === 1 || evt.button === 2 || (evt.button === 0 && spaceHeld)) {
      evt.preventDefault();
      const p = stage.getPointerPosition();
      if (p) panning = { pointer: { ...p }, origin: { x: stage.x(), y: stage.y() }, button: evt.button };
      return;
    }
    // A tool owns the left button: no marquee, no selection, no drag. The click
    // itself is handled on mouse UP so a pan that happens to start here is not also
    // a placement.
    if (tool !== undefined) return;
    // The marquee, by contrast, only starts on empty board: on an item the left
    // button belongs to selecting and dragging it.
    if (e.target !== stage) return;
    if (evt.button !== 0) return;
    marqueeFrom = worldPointer();
    marqueeTo = marqueeFrom;
    marqueeAdditive = evt.shiftKey;
    paintOverlay();
  });

  /**
   * The item under the pointer: whatever is DRAWN there, from Konva's own hit
   * graph, which is by construction the same answer a click gets.
   *
   * This used to compare the pointer against each item's box and take the last
   * match, and boxes lie in two ways that both showed up on the map. A zone's box
   * is not its outline, so the notch of an L-shaped corridor answered for the
   * corridor. Worse, anything drawn at a constant SCREEN size has a box that
   * shrinks as you zoom out: a pin's box is 18 world units while its disc is
   * always 9 screen pixels across, so at 30% the pointer sat on the visible dot
   * and outside its box, and the zone underneath claimed the rollover. The hit
   * graph has neither problem, and it costs no repaint to ask.
   */
  function itemAtPointer(): string | undefined {
    const pos = stage.getPointerPosition();
    if (!pos) return undefined;
    // Hit-test the whole layer and walk UP from what was hit, which is how this
    // has always worked; `groups` is the authority on what an id belongs to,
    // because a caller is free to give its own shapes ids and those are not items.
    //
    // Content, chrome and markers now share a layer, so what comes back may be a
    // vertex handle or a comment marker. Those are not items, the walk finds
    // nothing for them in `groups`, and this returns undefined - which is the
    // right answer, not a gap: pressing a handle that happens to sit over a card
    // is pressing the handle, and the surface has already decided what a press on
    // chrome means (see `pressedChrome`).
    let node: Konva.Node | null = mainLayer.getIntersection(pos);
    while (node && node !== mainLayer) {
      const id = node.id();
      if (id !== "" && groups.get(id) === node) return id;
      node = node.getParent();
    }
    return undefined;
  }

  /** What the pointer is over. No repaint: reading the hit graph does not touch
   *  the scene, which is what lets hover be tracked at all (see DrawContext). */
  let hovered: string | undefined;
  function trackHover(): void {
    const found = itemAtPointer();
    if (found === hovered) return;
    hovered = found;
    opts.onHover?.(hovered);
    paintHoverTip();
  }

  function clearHover(): void {
    if (hovered === undefined) return;
    hovered = undefined;
    opts.onHover?.(undefined);
    hideTip();
  }

  /** The tip for whatever is under the pointer, if the caller wants one. Also
   *  called on a camera move, which both re-anchors it to the shape it belongs
   *  to and re-asks the question: zooming in past the point where the face shows
   *  its own name should take the stand-in away. */
  function paintHoverTip(): void {
    if (opts.hoverTip === undefined) return;
    const item = hovered === undefined ? undefined : items.find((i) => i.id === hovered);
    const text = item === undefined ? undefined : opts.hoverTip(item, stage.scaleX());
    const rect = hovered === undefined ? undefined : screenRectOf(hovered);
    if (item === undefined || text === undefined || text === "" || rect === undefined) { hideTip(); return; }
    // Viewport coordinates: `screenRectOf` is relative to the stage's container,
    // and the bubble is placed against the window.
    const origin = stage.container().getBoundingClientRect();
    tipAt(item.id, {
      left: origin.left + rect.x, top: origin.top + rect.y, width: rect.width, height: rect.height,
    }, text);
  }

  stage.on("mousemove", () => {
    // A tool wants every move, for its rubber band, and no hover chrome.
    if (tool !== undefined) {
      clearHover();
      if (!panning) tool.onMove?.(worldPointer());
    }
    // Hover is meaningless mid-gesture, and chrome that follows a dragging card
    // is a distraction.
    else if (dragStart || panning || marqueeFrom) clearHover(); else trackHover();
    if (panning) {
      const p = stage.getPointerPosition();
      if (!p) return;
      if (Math.abs(p.x - panning.pointer.x) > 2 || Math.abs(p.y - panning.pointer.y) > 2) panMoved = true;
      stage.position({
        x: panning.origin.x + (p.x - panning.pointer.x),
        y: panning.origin.y + (p.y - panning.pointer.y),
      });
      afterCamera();
      return;
    }
    if (marqueeFrom) {
      marqueeTo = worldPointer();
      paintOverlay();
    }
  });

  /**
   * Does the item, AS DRAWN at this zoom, meet this world box?
   *
   * The box on a `CanvasItem` is what the surface positions and drags by, and for
   * anything drawn at a constant SCREEN size it is not what you can see. A site's
   * box is 18 world units while its disc is always 9 screen pixels across, so at
   * 30% a marquee that came nowhere near the visible dot still took it, and at
   * 300% one swept straight across the dot missed. `itemAtPointer` already
   * refuses to believe boxes for exactly this reason and asks Konva's hit graph
   * instead; a marquee cannot, because there is no pointer to hit-test with, so
   * it has to do the geometry itself.
   *
   * A disc gets a real circle-versus-rectangle test rather than a square standing
   * in for it. Substituting a screen-sized BOX would fix the scale half and leave
   * the corners over-selecting, which is the same kind of lie one size smaller.
   *
   * NOT done here, knowingly: a zone polygon still meets by its bounding box, so
   * a marquee inside the courtyard an L-shaped corridor wraps around takes the
   * corridor. That is the other lie `itemAtPointer` lists, it needs
   * polygon-versus-rectangle, and no map has yet been drawn where it bites.
   */
  function meetsBox(i: T, box: { x: number; y: number; width: number; height: number }): boolean {
    if (i.discRadius !== undefined) {
      const cx = i.x + i.width / 2, cy = i.y + i.height / 2;
      const r = i.discRadius / stage.scaleX();
      // The nearest point of the box to the centre: inside it, that is the centre
      // itself, so a box swallowing the disc reads as a hit without a special case.
      const nx = Math.min(Math.max(cx, box.x), box.x + box.width);
      const ny = Math.min(Math.max(cy, box.y), box.y + box.height);
      return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
    }
    return i.x < box.x + box.width && i.x + i.width > box.x
      && i.y < box.y + box.height && i.y + i.height > box.y;
  }

  const endGesture = (): void => {
    panning = undefined;
    if (!marqueeFrom || !marqueeTo) return;
    const box = boxBetween(marqueeFrom, marqueeTo);
    const drawn = box.width > 1 || box.height > 1;
    marqueeFrom = undefined;
    marqueeTo = undefined;
    if (!drawn) {
      // A click, not a sweep: empty space clears, which is the one gesture that
      // must not be swallowed by having a marquee at all.
      if (selected.size > 0 && !marqueeAdditive) setSelection([]);
      else paintOverlay();
      return;
    }
    // Intersection, not containment: a marquee that only takes fully-enclosed
    // items feels broken when you sweep across a dense cluster.
    const hits = items.filter((i) => i.locked !== true && meetsBox(i, box));
    const ids = hits.map((i) => i.id);
    setSelection(marqueeAdditive ? [...selected, ...ids] : ids);
  };
  stage.on("mouseup", endGesture);
  // A pointer released outside the canvas must not leave a gesture running.
  const onWindowUp = (): void => {
    // A press that never became a drag still has to release its hold on repaints,
    // and it can end anywhere: outside the canvas, over another item, or on a
    // click that only selected.
    if (pressed) {
      pressed = false;
      if (!dragStart && repaintAfterDrag) { repaintAfterDrag = false; paintItems(); }
    }
    if (panning || marqueeFrom) endGesture();
  };
  window.addEventListener("mouseup", onWindowUp);
  stage.on("mouseleave", clearHover);

  // Right-click. The surface has no menu of its own: every other view in this app
  // opens a DOM context menu, so the canvas reports the click and reuses it.
  // Swallowed always: the menu is opened from the right mouse UP instead (see the
  // camera note), so that a right-DRAG can pan without the menu appearing at the
  // moment of the press.
  stage.on("contextmenu", (e) => e.evt.preventDefault());

  stage.on("mouseup", (e) => {
    if (!(e.evt instanceof MouseEvent)) return;
    // A tool's placement: on the UP, and not when the gesture was a pan, so
    // right-dragging your way around the canvas never drops a vertex.
    if (tool !== undefined && e.evt.button === 0) {
      const dragged = panMoved;
      endGesture();
      if (!dragged) tool.onClick(worldPointer());
      return;
    }
    if (e.evt.button !== 2) return;
    const dragged = panMoved;
    endGesture();
    if (dragged) return;                                  // that was a pan
    // Chrome owns its own right-click: a vertex handle offers "remove this corner",
    // and the zone's menu opening on top of it would be two menus for one press.
    if (pressedChrome) return;
    const world = worldPointer();
    // Right-clicking an item that is not in the selection selects it first, so the
    // menu always acts on what the author is pointing at (the Finder behaviour);
    // right-clicking one that IS in a selection leaves the selection alone.
    const under = itemAtPointer();
    if (under !== undefined && !selected.has(under)) setSelection([under]);
    opts.onContext?.(under, world, e.evt);
  });

  stage.on("wheel", (e) => {
    e.evt.preventDefault();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Zoom about the POINTER, so whatever is under the cursor stays put.
      zoomAt(pointer, Math.pow(1.0025, -e.evt.deltaY));
      return;
    }
    // Shift makes the wheel horizontal, as it does in every browser and every
    // canvas tool. A trackpad sends deltaX of its own, so both paths are honoured.
    const dx = e.evt.shiftKey ? e.evt.deltaX + e.evt.deltaY : e.evt.deltaX;
    const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
    stage.position({ x: stage.x() - dx, y: stage.y() - dy });
    afterCamera(false);
  });

  function zoomAt(pointer: { x: number; y: number }, factor: number): void {
    const scale = stage.scaleX();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (next === scale) return;
    const world = { x: (pointer.x - stage.x()) / scale, y: (pointer.y - stage.y()) / scale };
    stage.scale({ x: next, y: next });
    stage.position({ x: pointer.x - world.x * next, y: pointer.y - world.y * next });
    afterCamera();
  }

  /** After any camera move. A pan only needs the grid, the backdrop and the
   *  overlay; a zoom also redraws the items, because `draw` is handed the scale
   *  and is allowed to abbreviate at small sizes.
   *
   *  Coalesced to one frame: wheel and mousemove arrive faster than the screen
   *  refreshes, and a zoom repaint rebuilds every node. The camera itself moves
   *  synchronously, so anything reading the scale back sees it at once. */
  let cameraFrame = 0;
  let cameraZoomed = false;

  function afterCamera(zoomed = true): void {
    cameraZoomed = cameraZoomed || zoomed;
    if (cameraFrame !== 0) return;
    cameraFrame = requestAnimationFrame(() => {
      cameraFrame = 0;
      const withItems = cameraZoomed;
      cameraZoomed = false;
      gridLayer.batchDraw();
      repaintBackdrop();
      repaintChrome();
      // Markers hold a constant size on screen, so they redraw with the camera
      // exactly as chrome does.
      repaintMarkers();
      if (withItems) paintItems(); else paintOverlay();
      refreshControls();
      paintHoverTip();
      opts.onCamera?.(stage.scaleX());
    });
  }

  /**
   * Swap the tool. The ONE path: the public setTool and the Escape key both come
   * through here, so a tool is cancelled exactly once however it ends.
   *
   * The state changes BEFORE the outgoing tool is told, which is not a nicety.
   * Every caller's onCancel ends by clearing the tool, so notifying first put this
   * and onCancel in a cycle: the recursion blew the stack halfway through creating
   * a zone, leaving the shape in the caller's model and nothing on the screen.
   * Clearing first makes the nested call a no-op.
   */
  function useTool(next: CanvasTool | undefined): void {
    const outgoing = tool;
    if (outgoing === next) return;
    tool = next;
    // A tool means every click is a place on the canvas, so the items stop
    // listening: that is what lets a pin be dropped INSIDE a zone rather than only
    // on empty ground. Handles keep listening, because a tool and a handle never
    // coexist (arming a tool clears the selection they belong to).
    contentGroup.listening(next === undefined);
    opts.host.style.cursor = next?.cursor ?? "";
    if (next !== undefined) setSelection([]);
    outgoing?.onCancel?.();
  }

  /**
   * The painted layers, which are torn down and rebuilt.
   *
   * Backdrop and foreground are one call; CHROME is separate, and that separation
   * is load-bearing. Rebuilding a layer destroys its nodes, and the chrome layer is
   * the one the pointer holds: a caller redrawing its shape preview on every frame
   * of a vertex drag would destroy the handle mid-drag, and the drag would die
   * after a few pixels. So a caller can refresh what it is drawing without
   * disturbing what the hand is holding.
   */
  function repaintBackdrop(): void {
    backdropLayer.destroyChildren();
    backdrop?.(backdropLayer, stage.scaleX(), liveItem);
    backdropLayer.batchDraw();
    foreGroup.destroyChildren();
    foreground?.(foreGroup, stage.scaleX(), liveItem);
    mainLayer.batchDraw();
  }

  // Each group destroys only its OWN children, so a marker drag does not rebuild
  // the map's vertex handles and a vertex drag does not make markers flicker.
  function repaintChrome(): void {
    chromeGroup.destroyChildren();
    chrome?.(chromeGroup, stage.scaleX(), liveItem);
    mainLayer.batchDraw();
  }

  function repaintMarkers(): void {
    markerGroup.destroyChildren();
    markers?.(markerGroup, stage.scaleX(), liveItem);
    mainLayer.batchDraw();
  }

  /** An item at its LIVE position: the group's coordinates when there is one (so
   *  a drag in flight is truthful), the model's otherwise. This is what lets
   *  edges stay attached to a card while it moves instead of catching up when it
   *  lands, which looks broken. */
  function liveItem(id: string): T | undefined {
    const item = items.find((i) => i.id === id);
    if (!item) return undefined;
    const group = groups.get(id);
    return group ? { ...item, x: group.x(), y: group.y() } : item;
  }

  /** Where an item is on screen right now, relative to the stage's container.
   *  Hoisted out of the public surface because the hover tip needs it too. */
  function screenRectOf(id: string): { x: number; y: number; width: number; height: number } | undefined {
    const item = liveItem(id);
    if (!item) return undefined;
    const scale = stage.scaleX();
    return {
      x: stage.x() + item.x * scale, y: stage.y() + item.y * scale,
      width: item.width * scale, height: item.height * scale,
    };
  }

  function contentBounds(of: T[]): { x: number; y: number; width: number; height: number } | undefined {
    if (of.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of of) {
      minX = Math.min(minX, i.x); minY = Math.min(minY, i.y);
      maxX = Math.max(maxX, i.x + i.width); maxY = Math.max(maxY, i.y + i.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /** A fit asked for before the surface had a size, to be honoured once it has
   *  one. A view mounted in a tab that is not on screen yet, or in a window
   *  still being laid out, measures 0 and would otherwise fit to nothing and
   *  stay there. */
  let pendingFit = false;

  function fitAll(): void { frame(items, { magnify: false, keepZoomIfItFits: false }); }

  /** Centre the selection. The zoom is left alone when the selection already fits
   *  at it: the author chose that zoom, and "show me what I selected" is a
   *  request to look somewhere, not to be zoomed about. */
  function showSelection(): void {
    if (selected.size === 0) return;
    frame(items.filter((i) => selected.has(i.id)), { magnify: false, keepZoomIfItFits: true });
  }

  /** Is every one of these items fully inside the viewport as it stands? */
  function allInView(subject: T[]): boolean {
    if (subject.length === 0) return true;
    const scale = stage.scaleX();
    const margin = 8;
    return subject.every((item) => {
      const x = stage.x() + item.x * scale;
      const y = stage.y() + item.y * scale;
      return x >= margin && y >= margin
        && x + item.width * scale <= stage.width() - margin
        && y + item.height * scale <= stage.height() - margin;
    });
  }

  function frame(subject: T[], opts: { magnify: boolean; keepZoomIfItFits: boolean }): void {
    if (stage.width() <= 1 || stage.height() <= 1) { pendingFit = true; return; }
    const bare = contentBounds(subject);
    if (!bare) return;
    const m = opts_fitMargin;
    const box = {
      x: bare.x - m.left, y: bare.y - m.top,
      width: bare.width + m.left + m.right,
      height: bare.height + m.top + m.bottom,
    };
    const room = {
      // A pane too narrow for the padding still gets a usable scale rather than
      // a negative one that clamps to the minimum zoom.
      width: Math.max(40, stage.width() - FIT_PADDING * 2),
      height: Math.max(40, stage.height() - FIT_PADDING * 2),
    };
    // Fit shrinks to reveal; it never MAGNIFIES. A deck of two cards framed at
    // 300% draws cards several times the size they are designed at, which reads
    // as a mistake rather than as a fit. Zooming in is the author's to ask for.
    const ceiling = opts.magnify ? MAX_SCALE : 1;
    const needed = Math.min(
      ceiling,
      Math.max(MIN_SCALE, Math.min(
        room.width / Math.max(1, box.width),
        room.height / Math.max(1, box.height),
      )),
    );
    const current = stage.scaleX();
    const scale = opts.keepZoomIfItFits && current <= needed ? current : needed;
    stage.scale({ x: scale, y: scale });
    centreWorld({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  function centreWorld(at: { x: number; y: number }): void {
    const scale = stage.scaleX();
    stage.position({ x: stage.width() / 2 - at.x * scale, y: stage.height() / 2 - at.y * scale });
    afterCamera();
  }

  /**
   * Back to 1:1, about the middle of the view, and NOTHING else.
   *
   * It used to jump the camera to the content's top-left as well, which was
   * wrong in the ordinary case and obviously so once the zoom cluster put the
   * control under the pointer: fit the board, see that it says 100%, click 100%,
   * and the view slides sideways for no reason anybody could name. Worse, the
   * jump happened even when the scale was ALREADY 1, so the button had a visible
   * effect while doing nothing.
   *
   * Zooming about the centre is what every canvas tool does and it composes:
   * at 100% already, `zoomAt` finds no change to make and the view holds
   * perfectly still. Getting back to content you have panned away from is
   * "fit everything", which is the button next door.
   */
  function actualSize(): void {
    zoomCentre(1 / stage.scaleX());
  }

  // --- keys -------------------------------------------------------------------
  // Guarded so nothing fires while the author is typing in a field somewhere.
  function typing(target: EventTarget | null): boolean {
    const t = target as HTMLElement | null;
    return !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable);
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e.target)) return;
    if (e.key === " ") { spaceHeld = true; opts.host.style.cursor = "grab"; return; }
    const mod = e.metaKey || e.ctrlKey;
    if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
      e.preventDefault();
      opts.onDelete?.([...selected]);
      return;
    }
    // A tool owns Enter and Escape: confirm the shape, or abandon it. This is the
    // convention the old system's canvas settled on and it is worth keeping
    // (Delete / Escape / Enter mean delete, cancel-the-draw, confirm-the-draw).
    if (tool !== undefined) {
      if (e.key === "Enter") { e.preventDefault(); tool.onCommit?.(); return; }
      if (e.key === "Escape") { e.preventDefault(); useTool(undefined); return; }
    }
    if (e.key === "Escape") {
      if (marqueeFrom) { marqueeFrom = undefined; marqueeTo = undefined; paintOverlay(); return; }
      if (selected.size > 0) setSelection([]);
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(items.filter((i) => i.locked !== true).map((i) => i.id));
      return;
    }
    if (mod && e.key === "0") { e.preventDefault(); actualSize(); return; }
    // Unmodified F and Home, which is the reflex every node and 3D tool has
    // trained (Unreal focuses the selection on F, Blender and Unreal frame
    // everything on Home). Deliberately NOT Cmd+F: that is Find, app-wide, and
    // this listener is on the window, so binding it here quietly stole it.
    if (!mod && e.key.toLowerCase() === "f") { e.preventDefault(); showSelection(); return; }
    if (!mod && e.key === "Home") { e.preventDefault(); fitAll(); return; }
    if (!mod && e.key.length === 1) opts.onKey?.(e.key.toLowerCase());
    if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomCentre(1.2); return; }
    if (mod && e.key === "-") { e.preventDefault(); zoomCentre(1 / 1.2); return; }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === " ") { spaceHeld = false; opts.host.style.cursor = ""; }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function zoomCentre(factor: number): void {
    zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, factor);
  }

  const onResize = (): void => {
    const width = Math.max(1, opts.host.clientWidth);
    const height = Math.max(1, opts.host.clientHeight);
    if (width === stage.width() && height === stage.height()) return;
    stage.width(width);
    stage.height(height);
    if (pendingFit && width > 1 && height > 1) {
      pendingFit = false;
      fitAll();
      return;
    }
    // NOT a zoom: a resize changes how much you can see, never how big anything
    // is, so the items do not need redrawing. This mattered more than it looks -
    // a pane resize used to rebuild every group, and the layout around a canvas
    // shifts for all sorts of innocent reasons (a status line below it wrapping
    // to two rows when a longer name is selected). A rebuild at the wrong moment
    // takes the node out from under a press and the next drag does nothing.
    afterCamera(false);
  };
  const observer = new ResizeObserver(onResize);
  observer.observe(opts.host);

  controls = mountCanvasControls(opts.host, {
    fitAll,
    fitSelection: showSelection,
    zoomIn: () => zoomCentre(1.2),
    zoomOut: () => zoomCentre(1 / 1.2),
    actualSize,
  });
  refreshControls();

  return {
    setItems(next) {
      items = next.map((i) => ({ ...i }));
      // The selection survives a refresh for anything still present, so an edit
      // elsewhere in the project does not clear what the author had in hand.
      selected = new Set([...selected].filter((id) => items.some((i) => i.id === id)));
      paintItems();
      repaintBackdrop();
      gridLayer.batchDraw();
      refreshControls();
    },
    setTokens(next) { tokens = next; paintItems(); repaintBackdrop(); repaintChrome(); repaintMarkers(); gridLayer.batchDraw(); },
    setBackdrop(paint) { backdrop = paint; repaintBackdrop(); },
    setForeground(paint) { foreground = paint; repaintBackdrop(); },
    setChrome(paint) { chrome = paint; repaintChrome(); },
    setMarkers(paint) { markers = paint; repaintMarkers(); },
    repaintMarkers,
    setTool: useTool,
    selection: () => [...selected],
    select: (ids) => setSelection(ids),
    fitAll,
    showSelection,
    revealIfOffscreen(ids) {
      const subject = items.filter((i) => ids.includes(i.id));
      if (subject.length === 0 || allInView(subject)) return;
      frame(subject, { magnify: false, keepZoomIfItFits: true });
    },
    actualSize,
    zoomBy: (factor) => zoomCentre(factor),
    scale: () => stage.scaleX(),
    screenRect: screenRectOf,
    toScreen: (at) => ({
      x: at.x * stage.scaleX() + stage.x(),
      y: at.y * stage.scaleY() + stage.y(),
    }),
    camera: () => ({ x: stage.x(), y: stage.y(), scale: stage.scaleX() }),
    setCamera(camera) {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale));
      stage.scale({ x: scale, y: scale });
      stage.position({ x: camera.x, y: camera.y });
      // A restored camera counts as a fit: nothing is pending any more.
      pendingFit = false;
      afterCamera();
    },
    centreOn(id) {
      const item = items.find((i) => i.id === id);
      if (item) centreWorld({ x: item.x + item.width / 2, y: item.y + item.height / 2 });
    },
    centreAt: centreWorld,
    resize: onResize,
    destroy() {
      if (cameraFrame !== 0) cancelAnimationFrame(cameraFrame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mouseup", onWindowUp);
      observer.disconnect();
      hideTip();
      controls?.destroy();
      stage.destroy();
    },
  };
}
