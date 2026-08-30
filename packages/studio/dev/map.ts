// ---------------------------------------------------------------------------
// The map lab: zone shapes and hand sites, driven by hand outside Electron.
//
//   npm run canvas-lab   (from packages/studio), then open /map.html
//
// The sibling of the canvas lab, for the same reason: a canvas cannot be proven
// by a unit test, and a shape's ink has to be looked at. The zones, the sites and
// the geometry are the REAL modules the app's Map view uses (map-art.ts,
// canvas-surface.ts, model/spatial.ts). If this page drew its own, it would stop
// being evidence about the app.
//
// What the lab owns is the AWKWARD geometry, which no tidy example project has:
//
//   - an L-shaped corridor, whose centre of area is OUTSIDE it (the label test)
//   - a C-shaped hall wrapped round a courtyard that belongs to nobody
//   - a small zone drawn INSIDE a big one, which is how rooms and wings work
//   - a zone with a long name, and one with a very short one
//   - a pin in no zone at all, which is a real state and has to look like one
// ---------------------------------------------------------------------------

import "../src/renderer/src/theme.css";
import "@wildwinter/app-shell/tooltip.css";
import { initTooltips } from "@wildwinter/app-shell";
import { mountCanvasSurface, type DrawContext } from "../src/renderer/src/canvas-surface.js";
import { onImageReady } from "../src/renderer/src/image-cache.js";
import { readCanvasTokens, watchCanvasTokens } from "../src/renderer/src/canvas-tokens.js";
import {
  drawSite, drawZone, paintZoneLabels, sitePoint, siteShape, zoneShape, LABEL_FLOOR, type SiteShape, type ZoneShape, backgroundShape, drawBackground, type BackgroundShape,
} from "../src/renderer/src/map-art.js";
import {
  closesShape, paintDraft, paintHandles, withVertexAfter, withVertexAt, withoutVertex, paintScaleHandles,
} from "../src/renderer/src/map-edit.js";
import { zoneAt } from "../../model/src/spatial.js";
import type { Polygon } from "../../model/src/spatial.js";
import Konva from "konva";

type MapItem =
  | (BackgroundShape & { kind: "background" })
  | (ZoneShape & { kind: "zone" })
  | (SiteShape & { kind: "pin" });

const P = (...pairs: [number, number][]): Polygon => pairs.map(([x, y]) => ({ x, y }));

/** A floor plan's worth of awkward shapes, at map scale (a few hundred units). */
const ZONES: { id: string; name: string; polygon: Polygon }[] = [
  // The district: everything else sits inside or beside it.
  { id: "quarter", name: "the-riverside-quarter", polygon: P([0, 0], [520, 0], [520, 380], [0, 380]) },
  // A room inside the district: the overlap case.
  { id: "square", name: "market-square", polygon: P([60, 60], [240, 60], [240, 200], [60, 200]) },
  // An L-shaped corridor: its centre of area falls in the notch.
  { id: "corridor", name: "the-long-corridor", polygon: P([300, 40], [480, 40], [480, 100], [360, 100], [360, 330], [300, 330]) },
  // A C-shaped hall around a courtyard that is NOT part of it.
  { id: "hall", name: "hall", polygon: P([60, 240], [260, 240], [260, 280], [130, 280], [130, 320], [260, 320], [260, 356], [60, 356]) },
  // A zone outside the district, to prove a fit frames everything.
  { id: "docks", name: "docks", polygon: P([560, 120], [700, 90], [730, 250], [580, 280]) },
];

const PINS: { id: string; name: string; at: { x: number; y: number }; zone?: string }[] = [
  { id: "h_market", name: "market-street", at: { x: 150, y: 130 }, zone: "square" },
  { id: "h_corridor", name: "corridor-watch", at: { x: 330, y: 250 }, zone: "corridor" },
  { id: "h_docks", name: "docks-street", at: { x: 640, y: 180 }, zone: "docks" },
  // In the courtyard the C wraps around: inside the bounding box of "hall", inside
  // nothing at all. A pin that looked bound here would be a lie.
  { id: "h_lost", name: "nowhere-in-particular", at: { x: 190, y: 300 } },
];

/** A zone's name from its id: a pin is coloured by the ground it stands on. */
const nameOfZone = (id: string | undefined): string | undefined =>
  (id === undefined ? undefined : ZONES.find((z) => z.id === id)?.name);

const items: MapItem[] = [
  ...ZONES.map((z): MapItem => ({ kind: "zone", ...zoneShape({ id: z.id, title: z.name, name: z.name, polygon: z.polygon }) })),
  ...PINS.map((p): MapItem => ({
    kind: "pin",
    ...siteShape({
      id: p.id, title: p.name, name: p.name, at: p.at,
      ...(p.zone !== undefined ? { zone: p.zone, zoneName: nameOfZone(p.zone) } : {}),
    }),
  })),
];

const zonesNow = (): { id: string; polygon: Polygon }[] =>
  items.filter((i): i is ZoneShape & { kind: "zone" } => i.kind === "zone")
    .map((z) => ({ id: z.id, polygon: z.outline.map((p) => ({ x: z.x + p.x, y: z.y + p.y })) }));

const host = document.getElementById("stage")!;
const zoom = document.getElementById("zoom") as HTMLOutputElement;
const sel = document.getElementById("sel") as HTMLOutputElement;
const events = document.getElementById("events") as HTMLOutputElement;
const hover = document.getElementById("hover") as HTMLOutputElement;

let tokens = readCanvasTokens();
initTooltips();

/** A REAL floor plan, from dev/local (gitignored: see the folder's note). A
 *  2816x1536 PNG of about 10MB, which is the size these actually are - the whole
 *  point of looking at one is that a synthetic 400px square proves nothing about
 *  legibility, load time or the drop rule. */
const SITE = "/local/site.png";

/** The drop rule (graphical-views 2): a picture arrives at a size comfortable to
 *  manipulate relative to the CURRENT view, not at one pixel to one unit. 60% of
 *  the viewport's shorter side, aspect ratio kept, centred where it landed. */
function droppedRect(
  natural: { width: number; height: number },
  view: { width: number; height: number },
  scale: number,
  at: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  // FIT inside 60% of the viewport, both axes, rather than making the longer
  // axis 60% of the shorter side. Measured in the lab: the second reading put a
  // 1.83:1 site plan at a third of the width of a wide window, which is small
  // enough to be fiddly - and "easy to grab" was the whole requirement.
  const room = { width: view.width * 0.6, height: view.height * 0.6 };
  const fit = Math.min(room.width / natural.width, room.height / natural.height) / scale;
  const width = natural.width * fit;
  const height = natural.height * fit;
  return {
    x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2),
    width: Math.round(width), height: Math.round(height),
  };
}

const surface = mountCanvasSurface<MapItem>({
  host,
  tokens,
  grid: 0,
  hoverTip: (item, scale) => (scale < LABEL_FLOOR ? item.title : undefined),
  draw: (item: MapItem, ctx: DrawContext): Konva.Group => {
    if (item.kind === "background") return drawBackground(item, ctx);
    return item.kind === "zone" ? drawZone(item, ctx) : drawSite(item, ctx);
  },
  onCamera: (scale) => { zoom.textContent = `${Math.round(scale * 100)}%`; },
  onSelectionChange: (ids) => {
    sel.textContent = ids.length === 0 ? "nothing selected"
      : ids.length === 1 ? `${ids[0]}` : `${ids.length} selected`;
    picked = undefined;
    repaint();
  },
  onHover: (id) => { hover.textContent = id ? `hover ${id}` : "no hover"; },
  onDelete: () => {
    const chosen = surface.selection();
    const only = chosen.length === 1 ? items.find((i) => i.id === chosen[0]) : undefined;
    if (picked === undefined || only?.kind !== "zone") return;
    const zone = ZONES.find((z) => z.id === only.id);
    const next = zone ? withoutVertex(zone.polygon, picked) : undefined;
    if (!next) { events.textContent = "a zone needs three corners"; return; }
    picked = undefined;
    reshape(only.id, next);
  },
  onActivate: (id) => { events.textContent = `open ${id}`; },
  onContext: (id, world) => {
    events.textContent = id !== undefined
      ? `menu on ${id}`
      : `menu on empty at ${Math.round(world.x)},${Math.round(world.y)} (zone: ${zoneAt(world, zonesNow()) ?? "none"})`;
  },
  onMove: (moves) => {
    for (const move of moves) {
      const item = items.find((i) => i.id === move.id);
      if (item) { item.x = move.x; item.y = move.y; }
    }
    // A dragged ZONE writes its new outline first, so the rule below is applied
    // against where the zones are NOW.
    for (const move of moves) {
      const item = items.find((i) => i.id === move.id);
      if (item?.kind !== "zone") continue;
      const zone = ZONES.find((z) => z.id === item.id);
      if (zone) zone.polygon = item.outline.map((p) => ({ x: item.x + p.x, y: item.y + p.y }));
    }
    const said = bindSitesToZones();
    surface.setItems(items);
    repaint();
    events.textContent = said.length > 0 ? said.join("  ") : `moved ${moves.length}`;
  },
});

// --- the tools, the same modules the app's Map view drives -------------------
let draft: Polygon = [];
let pointer: { x: number; y: number } | undefined;
let preview: { id: string; polygon: Polygon } | undefined;
let drawing = false;
/** The corner picked out for Delete, mirroring the app. */
let picked: number | undefined;

/** Names and drafts. The app splits these from the handles for a reason: rebuilding
 *  chrome mid-drag destroys the handle in the hand, so a vertex drag repaints only
 *  this. The lab has to mirror the app's flow or it stops being evidence. */
/** A picture mid-scale: the rectangle it WOULD have. */
let scaling: { x: number; y: number; width: number; height: number } | undefined;

function paintNames(): void {
  surface.setForeground((layer, scale, at) => {
    paintZoneLabels(layer, scale, tokens, ZONES,
      (id) => { const item = at(id); return item?.kind === "zone" ? item : undefined; });
    if (draft.length > 0) paintDraft(layer, scale, tokens, draft, pointer);
    if (preview) paintDraft(layer, scale, tokens, preview.polygon, undefined);
    if (scaling) {
      layer.add(new Konva.Rect({
        x: scaling.x, y: scaling.y, width: scaling.width, height: scaling.height,
        stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale], listening: false,
      }));
    }
  });
}

function repaint(): void {
  paintNames();
  const chosen = surface.selection();
  const only = chosen.length === 1 ? items.find((i) => i.id === chosen[0]) : undefined;
  // A selected PICTURE gets corner handles, the same as the app: scale it
  // proportionally, previewing until it lands.
  if (!drawing && only?.kind === "background") {
    const picture = only;
    surface.setChrome((layer, scale) => {
      paintScaleHandles(layer, scale, tokens,
        { x: picture.x, y: picture.y, width: picture.width, height: picture.height }, {
          preview: (rect) => { scaling = rect; paintNames(); },
          commit: (rect) => {
            scaling = undefined;
            const at = items.findIndex((i) => i.id === picture.id);
            items[at] = { ...picture, ...rect };
            surface.setItems(items);
            repaint();
            events.textContent = `scaled to ${rect.width}x${rect.height}`;
          },
        });
    });
    return;
  }
  if (drawing || only?.kind !== "zone") { surface.setChrome(undefined); return; }
  const zone = only;
  const outline = (): Polygon => zone.outline.map((p) => ({ x: zone.x + p.x, y: zone.y + p.y }));
  surface.setChrome((layer, scale) => {
    paintHandles(layer, scale, tokens, outline(), {
      previewVertex: (i, to) => {
        preview = to === undefined ? undefined : { id: zone.id, polygon: withVertexAt(outline(), i, to) };
        paintNames();
      },
      moveVertex: (i, to) => reshape(zone.id, withVertexAt(outline(), i, to)),
      insertVertex: (i, at) => { reshape(zone.id, withVertexAfter(outline(), i, at)); picked = i + 1; repaint(); },
      selectVertex: (i) => { picked = i; repaint(); },
      menuForVertex: (i) => {
        // The lab has no DOM menu; the act it would offer is what matters here.
        const next = withoutVertex(outline(), i);
        events.textContent = next ? `menu: remove corner ${i + 1}` : "menu: a zone needs three corners";
      },
    }, picked);
  });
}

/** Write a new outline into the lab's own model, exactly as the app writes it to a
 *  shard: the shape is replaced, and every pin's zone is re-derived. */
function reshape(id: string, polygon: Polygon): void {
  const zone = ZONES.find((z) => z.id === id);
  if (zone) zone.polygon = polygon.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const at = items.findIndex((i) => i.id === id);
  if (at >= 0 && zone) items[at] = { kind: "zone", ...zoneShape({ id, title: zone.name, name: zone.name, polygon: zone.polygon }) };
  preview = undefined;
  bindSitesToZones();
  surface.setItems(items);
  repaint();
  events.textContent = `reshaped ${id} (${polygon.length} corners)`;
}

/**
 * The app's rule, in the lab's own terms (mutate.ts `bindSitesToZones`): a pinned
 * hand belongs to the zone its pin is standing in, re-derived after EITHER side
 * moves, and a pin outside every zone leaves its hand loose (drawn hollow, and
 * an error in the app, where a hand that needs a zone must have one).
 */
function bindSitesToZones(): string[] {
  const said: string[] = [];
  for (const item of items) {
    if (item.kind !== "pin") continue;
    const zone = zoneAt(sitePoint(item), zonesNow());
    if (zone === item.zone) continue;
    item.zone = zone;
    item.zoneName = nameOfZone(zone);
    item.unbound = zone === undefined;
    said.push(`${item.id} -> ${zone ?? "loose"}`);
  }
  return said;
}

function stopTool(): void {
  drawing = false;
  draft = [];
  pointer = undefined;
  surface.setTool(undefined);
  repaint();
}

document.getElementById("addzone")!.addEventListener("click", () => {
  drawing = true;
  draft = [];
  surface.setTool({
    cursor: "crosshair",
    onClick: (at) => {
      if (closesShape(draft, at, surface.scale())) { finish(); return; }
      draft = [...draft, { x: Math.round(at.x), y: Math.round(at.y) }];
      repaint();
      events.textContent = `${draft.length} corner(s)`;
    },
    onMove: (at) => { pointer = at; repaint(); },
    onCommit: () => finish(),
    onCancel: () => { stopTool(); events.textContent = "cancelled"; },
  });
  events.textContent = "click to place corners; Enter or the first corner closes";
});

function finish(): void {
  if (draft.length < 3) { stopTool(); events.textContent = "abandoned (under three corners)"; return; }
  const id = `zone-${ZONES.length + 1}`;
  const name = `new-zone-${ZONES.length + 1}`;
  ZONES.push({ id, name, polygon: draft.map((p) => ({ ...p })) });
  items.push({ kind: "zone", ...zoneShape({ id, title: name, name, polygon: ZONES[ZONES.length - 1]!.polygon }) });
  stopTool();
  bindSitesToZones();
  surface.setItems(items);
  surface.select([id]);
  repaint();
  events.textContent = `drew ${name}`;
}

document.getElementById("addpin")!.addEventListener("click", () => {
  const id = `h_new_${items.filter((i) => i.kind === "pin").length + 1}`;
  surface.setTool({
    cursor: "crosshair",
    onClick: (at) => {
      const zone = zoneAt(at, zonesNow());
      surface.setTool(undefined);
      items.push({
        kind: "pin",
        ...siteShape({
          id, title: id, name: id, at: { x: Math.round(at.x), y: Math.round(at.y) },
          ...(zone !== undefined ? { zone, zoneName: nameOfZone(zone) } : {}),
        }),
      });
      surface.setItems(items);
      repaint();
      events.textContent = `pinned ${id} in ${zone ?? "no zone"}`;
    },
    onCancel: () => { stopTool(); events.textContent = "cancelled"; },
  });
  events.textContent = "click where the hand sits";
});

surface.setItems(items);
repaint();
surface.fitAll();

watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); });

(document.getElementById("theme") as HTMLSelectElement).addEventListener("change", (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (value) document.documentElement.setAttribute("data-theme", value);
  else document.documentElement.removeAttribute("data-theme");
});

// A handle for the browser tools, so the surface can be driven without a hand on
// the trackpad (the canvas lab does the same).
/** Drop the real floor plan in, by the rule: sized against the CURRENT view.
 *  Its natural size is only known once the image has loaded, which is exactly the
 *  awkwardness worth exercising here. */
function addBackground(locked: boolean): void {
  const probe = new Image();
  probe.onload = () => {
    const el = document.getElementById("stage")!.getBoundingClientRect();
    const cam = surface.camera();
    const centre = { x: (el.width / 2 - cam.x) / cam.scale, y: (el.height / 2 - cam.y) / cam.scale };
    const rect = droppedRect(
      { width: probe.naturalWidth, height: probe.naturalHeight },
      { width: el.width, height: el.height }, cam.scale, centre,
    );
    items.unshift({
      kind: "background",
      ...backgroundShape({ id: "g_site", file: "site.png", url: SITE, ...rect, opacity: 0.6, locked }),
    });
    surface.setItems(items);
    repaint();
    events.textContent = `background ${probe.naturalWidth}x${probe.naturalHeight} -> ${rect.width}x${rect.height} at ${Math.round(cam.scale * 100)}%${locked ? " (locked)" : ""}`;
  };
  probe.onerror = () => { events.textContent = `no image at ${SITE} (put one in dev/local/)`; };
  probe.src = SITE;
}

// The app repaints when a picture finishes loading (map-view does this), so the
// lab must too or it sits looking at a placeholder for ever - and the lab only
// counts as evidence when it mirrors the app.
onImageReady(() => { surface.setItems(items); repaint(); });

document.getElementById("bg")?.addEventListener("click", () => addBackground(false));
document.getElementById("bglock")?.addEventListener("click", () => addBackground(true));

(window as unknown as { lab: unknown }).lab = { surface, items, zonesNow, addBackground, droppedRect };
