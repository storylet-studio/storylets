// ---------------------------------------------------------------------------
// The map: the venue plan, its locations, and what is waiting at each.
//
// LIFTED FROM THE PLAYABLE PAGE, on purpose (spec 12): the geometry and the
// drawing are the published page's (`packages/ops/player/player.ts`,
// `renderMap`) and the Village client's (`packages/village-client/src/map.ts`),
// down to the invisible finger-sized halo over an 11-unit pin and the card
// count inside the ring. Those two were tuned against real thumbs on real
// screens, and a third opinion about pin sizes would be a third thing to
// maintain.
//
// What is DIFFERENT is where the coordinates come from. The playable page
// draws a designer's map from the bundle's `maps` block; this draws the
// BUILDING, from a `VenueView`'s plan and the venue's `LocationView`s (wire
// 4a). One background, one coordinate space, so two stories on the same walls
// line up. Zones are optional and come from the installation whose map covers
// the place, since a venue plan has no zones of its own.
//
// Built ONCE and only updated, which is the Village client's own lesson: the
// first cut redrew everything on each click, re-fetched megabytes of
// background art and made the world flicker away.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { LocationId, LocationView, VenueView } from "@storylet-studio/wire";
import { cls, el, svg } from "./part.js";
import type { Part } from "./part.js";

/** A zone as an installation's map has it: the polygon and where to put its
 *  name. The same shape the playable page's `PlayableMap.zones` uses, so a
 *  console can hand one straight over. */
export interface MapZone {
  tag: string;
  polygon: { x: number; y: number }[];
  label: { x: number; y: number };
}

export interface VenueMapState {
  /** Cards waiting at each location, drawn inside the pin. A venue with
   *  nothing to count passes nothing and the pins stay blank. */
  counts?: Record<LocationId, number>;
  /** Where this device is, or where the party last scanned. */
  here?: LocationId;
  /** Stations standing at each location, for a console or a crew screen that
   *  shows colleagues. Drawn as a small second mark. */
  stations?: Record<LocationId, number>;
}

export interface VenueMapOptions {
  venue: VenueView;
  locations: LocationView[];
  /** The installation's zones over the same coordinate space, when there is a
   *  map that covers this venue. */
  zones?: MapZone[];
  /** A pin was tapped. Absent makes the map a display rather than a control,
   *  which is what a house screen wants. */
  onPick?(location: LocationId): void;
}

/** A stable hue per zone name: Patter's `hueOf`, by way of the playable page
 *  and the editor's colour-by-name. */
const hueOf = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};

/** Everything the drawing covers, so it fits the plan the venue uploaded
 *  rather than a size hard-coded here. */
function extent(opts: VenueMapOptions): { x: number; y: number; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  if (opts.venue.plan !== undefined) {
    xs.push(0, opts.venue.plan.width);
    ys.push(0, opts.venue.plan.height);
  }
  for (const z of opts.zones ?? []) for (const p of z.polygon) { xs.push(p.x); ys.push(p.y); }
  // The pin's own furniture: its name sits 27 below, its halo 26 around.
  for (const l of opts.locations) { xs.push(l.x - 40, l.x + 40); ys.push(l.y - 16, l.y + 34); }
  if (xs.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
  const pad = 16;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY };
}

export function venueMapPart(opts: VenueMapOptions): Part<VenueMapState> {
  const root = el("div", { className: cls("part", "map-wrap") });
  const box = extent(opts);
  const map = svg("svg", { class: cls("map"), viewBox: `${box.x} ${box.y} ${box.w} ${box.h}` });
  map.setAttribute("role", "img");
  map.setAttribute("aria-label", `Plan of ${opts.venue.name}`);

  // The plan, behind everything. A background that will not load is a poorer
  // map, never a broken one, so nothing here depends on it arriving.
  if (opts.venue.plan?.background !== undefined) {
    const image = svg("image", {
      x: 0, y: 0, width: opts.venue.plan.width, height: opts.venue.plan.height,
      preserveAspectRatio: "none",
    });
    image.setAttribute("href", opts.venue.plan.background);
    map.append(image);
  }

  for (const zone of opts.zones ?? []) {
    const hue = hueOf(zone.tag);
    map.append(svg("polygon", {
      class: cls("map-zone"),
      points: zone.polygon.map((p) => `${p.x},${p.y}`).join(" "),
      fill: `hsl(${hue} 60% 45%)`,
      stroke: `hsl(${hue} 60% 35%)`,
    }));
    const label = svg("text", {
      class: cls("map-zone-label"),
      x: zone.label.x, y: zone.label.y + 5, "text-anchor": "middle",
    });
    label.textContent = zone.tag;
    map.append(label);
  }

  const pins = new Map<LocationId, SVGElement>();
  const counters = new Map<LocationId, SVGElement>();
  const marks = new Map<LocationId, SVGElement>();

  for (const location of opts.locations) {
    const pin = svg("g", { class: cls("map-pin"), "data-location": location.location });
    // A generous invisible halo first: the drawn pin is 11 units and a finger
    // is not, and the audience here is somebody tapping a world they do not
    // know yet. (The playable page's own note.)
    const halo = svg("circle", { cx: location.x, cy: location.y, r: 26 });
    halo.setAttribute("style", "fill: transparent; stroke: none");
    pin.append(halo);
    pin.append(svg("circle", { cx: location.x, cy: location.y, r: 11, class: cls("map-pin-ring") }));
    const count = svg("text", { class: cls("map-pin-count"), x: location.x, y: location.y + 4 });
    pin.append(count);
    const name = svg("text", { class: cls("map-pin-name"), x: location.x, y: location.y + 27 });
    name.textContent = location.label;
    pin.append(name);
    // The second mark: who is standing here. A producer wants to notice the
    // performer in the forest, so it is drawn apart from the count.
    const mark = svg("text", { class: cls("map-pin-mark"), x: location.x + 16, y: location.y - 10 });
    pin.append(mark);
    if (opts.onPick) {
      pin.addEventListener("click", () => opts.onPick?.(location.location));
    }
    pins.set(location.location, pin);
    counters.set(location.location, count);
    marks.set(location.location, mark);
    map.append(pin);
  }

  root.append(map);
  let disposed = false;

  return {
    el: root,
    update(state) {
      if (disposed) return;
      for (const [id, pin] of pins) {
        const n = state.counts?.[id] ?? 0;
        pin.classList.toggle(cls("here"), id === state.here);
        pin.classList.toggle(cls("waiting"), n > 0);
        const counter = counters.get(id);
        if (counter) counter.textContent = n > 0 ? String(n) : "";
        const mark = marks.get(id);
        const standing = state.stations?.[id] ?? 0;
        if (mark) mark.textContent = standing > 0 ? "*".repeat(Math.min(standing, 3)) : "";
      }
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
      pins.clear();
      counters.clear();
      marks.clear();
    },
  };
}
