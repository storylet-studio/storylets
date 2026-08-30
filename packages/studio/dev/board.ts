// ---------------------------------------------------------------------------
// The Board map lab: the Board's read-only map, driven by hand outside Electron.
//
//   npm run canvas-lab   (from packages/studio), then open /board.html
//
// The third lab, for the same reason as the other two: a canvas cannot be proven
// by a unit test, and the Board is an Electron window nobody can drive from a
// test. This page mounts the REAL module (board-map.ts) over a hand-written
// BoxMapDto, so what is being looked at is what the Board renders.
//
// What it owns is the awkward part of THIS view: a run in progress. The live
// position and the trail are faked with two buttons, because the interesting
// question is whether a pin can wear a running mark legibly at map scale, next
// to a selection ring, without reading as a second pin.
// ---------------------------------------------------------------------------

import "../src/renderer/src/theme.css";
import "@wildwinter/app-shell/tooltip.css";
import { initTooltips } from "@wildwinter/app-shell";
import { charColour, readCanvasTokens } from "../src/renderer/src/canvas-tokens.js";
import { mountBoardMap } from "../src/renderer/table/board-map.js";
import type { BoardMapMarks } from "../src/renderer/table/board-map.js";
import type { BoxMapDto } from "../src/shared/api.js";

const stage = document.getElementById("stage")!;
const side = document.getElementById("side")!;
const events = document.getElementById("events")!;

/** A box with two zones, one of them nested, and four hands: one in each zone,
 *  one in the nested zone, and one standing in no zone at all. */
const MAP: BoxMapDto = {
  hasProject: true,
  groups: [{ id: "d_zone", gameId: "zone" }],
  groupId: "d_zone",
  zones: [
    { id: "v_village", gameId: "village", polygon: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 240 }, { x: 0, y: 240 }] },
    { id: "v_inn", gameId: "the-inn", polygon: [{ x: 40, y: 40 }, { x: 150, y: 40 }, { x: 150, y: 130 }, { x: 40, y: 130 }] },
    { id: "v_forest", gameId: "forest", polygon: [{ x: 380, y: 30 }, { x: 560, y: 10 }, { x: 590, y: 190 }, { x: 400, y: 210 }] },
  ],
  undrawn: [{ id: "v_docks", gameId: "docks" }],
  backgrounds: [],
  sites: [
    { id: "h_inn", gameId: "the-inn", x: 95, y: 85, zone: "v_inn", rebinds: true },
    { id: "h_square", gameId: "the-square", x: 240, y: 170, zone: "v_village", rebinds: true },
    { id: "h_tree", gameId: "the-mystic-tree", x: 480, y: 110, zone: "v_forest", rebinds: true },
    // Bound to a zone nobody has traced: its name must still read.
    { id: "h_docks", gameId: "the-docks-hand", x: 250, y: 300, zone: "v_docks", rebinds: true },
    // No route to this map's group at all: a pin that only marks a spot.
    { id: "h_nowhere", gameId: "out-of-story", x: 620, y: 260, rebinds: false },
  ],
  unplaced: [], furniture: { frames: [] },
};

initTooltips();

let selected: string | undefined;
let now: string | undefined;
let filtered: string | undefined;
const visited = new Set<string>();

/** What each hand is holding: the lab's stand-in for a dealt board. Chosen to
 *  cover the cases that matter - a busy place, a quiet one, and a place with
 *  nothing in it at all, which must not look like an error. */
const HELD: Record<string, number> = {
  "the-inn": 3, "the-square": 1, "the-mystic-tree": 12, "the-docks-hand": 0, "out-of-story": 2,
};

const marks = (): BoardMapMarks => ({
  ...(now !== undefined ? { now } : {}),
  ...(filtered !== undefined ? { filtered } : {}),
  visited: (h: string) => visited.has(h),
  changed: () => false,
  changedStamp: 0,
    held: (h: string) => HELD[h] ?? 0,
});

const map = mountBoardMap(stage, MAP, selected, marks(), {
  select: (hand) => {
    selected = hand;
    side.textContent = hand === undefined ? "nothing selected" : `selected: ${hand} (holding ${HELD[hand] ?? 0})`;
    events.textContent = `select ${hand ?? "(none)"}`;
    map.update(MAP, selected, marks());
  },
  filter: (zone) => {
    filtered = zone;
    events.textContent = `filter ${zone ?? "(all)"}`;
    map.update(MAP, selected, marks());
  },
  reveal: (hand) => { events.textContent = `reveal ${hand} in the editor`; },
});

document.getElementById("play")!.addEventListener("click", () => {
  if (selected === undefined) { events.textContent = "pick a pin first"; return; }
  now = selected;
  visited.add(selected);
  events.textContent = `played from ${selected} (live), visited: ${[...visited].join(", ")}`;
  map.update(MAP, selected, marks());
});

document.getElementById("reset")!.addEventListener("click", () => {
  now = undefined;
  visited.clear();
  events.textContent = "run reset";
  map.update(MAP, selected, marks());
});

(document.getElementById("theme") as HTMLSelectElement).addEventListener("change", (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (value) document.documentElement.setAttribute("data-theme", value);
  else document.documentElement.removeAttribute("data-theme");
});

(window as unknown as { lab: unknown }).lab = {
  map, MAP, marks: () => ({ now, visited: [...visited] }),
  // For inspection from the browser console: what colour does a name get?
  colourOf: (name: string) => charColour(readCanvasTokens(), name),
};
