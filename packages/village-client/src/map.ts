// The map: the drawn world, and the only way to move about it.
//
// Every coordinate here came out of the PROJECT. `playableMaps` (the same op
// the playable page uses) derived the zone polygons, the label points, the
// background pictures and the placed sites from the Village's own view shard,
// at build time. The client positions things; it decides none of them.
//
// This file contains no engine calls at all, on purpose: drawing a world is
// the game's job, and keeping it separate is what makes main.ts short enough
// to read.
/// <reference lib="dom" />

import { el } from "./dom.js";

/** One drawn place, as `playableMaps` hands it over. */
export interface VillageMap {
  box: string;
  boxTitle?: string;
  boxes: string[];
  group: string;
  zones: { tag: string; polygon: { x: number; y: number }[]; label: { x: number; y: number } }[];
  backgrounds: { src: string; x: number; y: number; width: number; height: number; opacity?: number }[];
  sites: { hand: string; label: string; box: string; x: number; y: number; zone?: string }[];
}

const NS = "http://www.w3.org/2000/svg";

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Everything the map covers, so the drawing fits whatever the designer drew
 *  rather than a size hard-coded here. */
function extent(maps: VillageMap[]): { x: number; y: number; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of maps) {
    for (const b of m.backgrounds) { xs.push(b.x, b.x + b.width); ys.push(b.y, b.y + b.height); }
    for (const z of m.zones) for (const p of z.polygon) { xs.push(p.x); ys.push(p.y); }
    for (const s of m.sites) { xs.push(s.x); ys.push(s.y); }
  }
  if (xs.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
  const pad = 60;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY };
}

/** Mount the map ONCE and hand back the two things the game changes about it.
 *
 *  Built once on purpose. The first cut redrew the whole map on every click,
 *  which re-fetched several megabytes of background art each time a card was
 *  opened and made the world flicker away. A map is scenery: it is drawn when
 *  the world is loaded, and after that only the marker moves. */
/** What the map shows about a place: where you are, and whether anything is
 *  waiting there. */
export interface MapState {
  at: string | null;
  /** Hand gameId -> how many cards are on its table right now. */
  counts: Record<string, number>;
}

export function mountMap(
  host: HTMLElement,
  maps: VillageMap[],
  go: (site: string | null) => void,
): { update: (state: MapState) => void } {
  const box = extent(maps);
  const root = svg("svg", { viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`, class: "mapsvg" });
  const pins = new Map<string, SVGElement>();
  const counters = new Map<string, SVGElement>();

  for (const map of maps) {
    // The pictures the designer placed, at the size and opacity they placed
    // them. A background that could not be read was dropped at build time with
    // a warning: a missing picture is a poorer map, never a broken one.
    for (const b of map.backgrounds) {
      root.append(svg("image", {
        href: `assets/${b.src}`, x: b.x, y: b.y, width: b.width, height: b.height,
        opacity: b.opacity ?? 1, preserveAspectRatio: "none",
      }));
    }
    for (const z of map.zones) {
      root.append(svg("polygon", { class: "zone", points: z.polygon.map((p) => `${p.x},${p.y}`).join(" ") }));
      const text = svg("text", { class: "zonename", x: z.label.x, y: z.label.y });
      text.textContent = z.tag;
      root.append(text);
    }
    for (const s of map.sites) {
      const pin = svg("g", { class: "site", transform: `translate(${s.x} ${s.y})` });
      pin.append(svg("circle", { r: 26 }));
      // How many cards are waiting here. The Village opens almost entirely
      // closed - one site has anything at all until you arrive - so a map of
      // identical pins reads as "nothing works". The count is the same
      // affordance the published playable page puts on its pins, and it is the
      // difference between a world that looks broken and one that looks shut.
      const count = svg("text", { class: "count", y: 9 });
      pin.append(count);
      const label = svg("text", { class: "sitename", y: 62 });
      label.textContent = s.label;
      pin.append(label);
      counters.set(s.hand, count);
      pin.addEventListener("click", () => go(pin.classList.contains("here") ? null : s.hand));
      pins.set(s.hand, pin);
      root.append(pin);
    }
  }

  const leave = el("button", { className: "leave", text: "Back to the map", onClick: () => go(null) });
  leave.hidden = true;
  host.replaceChildren(root, leave);

  return {
    update({ at, counts }: MapState): void {
      for (const [hand, pin] of pins) {
        const n = counts[hand] ?? 0;
        pin.classList.toggle("here", hand === at);
        pin.classList.toggle("waiting", n > 0);
        counters.get(hand)!.textContent = n > 0 ? String(n) : "";
      }
      leave.hidden = at === null;
    },
  };
}
