// ---------------------------------------------------------------------------
// A box's colour: the one the project map tints its layer, its pins, its chips
// and its navigator glyph with.
//
// STORED, never computed here (the surfacing review's round-3 ruling). Main
// gives a box the first palette slot no other box on the map uses when it
// joins, saves it in the box's view sidecar, and the author can change it from
// the swatch on its layer (main box-colours.ts). This file only remembers what
// main said. Working it out from the box's place in the project, as this file
// used to, recoloured every layer when a box was added above or the boxes were
// reordered, and the Board never knew.
//
// A box with no stored colour is one that has never been on a map that was
// drawn, so nothing shows it as a layer; it falls back to the hash every other
// identity colour in the app uses, which is stable by id.
//
// Module state, set by the renderer whenever a project result or a map lands
// (the same shape as views.ts `setCameFrom`): every caller has a box id to hand
// and nothing else, and threading the colours through each of them would be a
// parameter none of them decides.
// ---------------------------------------------------------------------------

import { colourIndex } from "../../shell/colour.js";

const stored = new Map<string, number>();

/** What main says each box's colour is. Boxes it names with no colour keep
 *  whatever this already knew (a project result is older than a map that has
 *  just stored one), and an answer that changes nothing reports false, so the
 *  caller repaints only when something did change. */
export function setBoxColours(boxes: readonly { id: string; colour?: number }[]): boolean {
  let changed = false;
  for (const b of boxes) {
    if (b.colour === undefined || stored.get(b.id) === b.colour) continue;
    stored.set(b.id, b.colour);
    changed = true;
  }
  return changed;
}

/** A different project: what the last one's boxes were is no answer here. */
export function forgetBoxColours(): void {
  stored.clear();
}

/** The palette index for a box, by id. */
export function boxColourIndex(boxId: string): number {
  return stored.get(boxId) ?? colourIndex(boxId);
}

/** The same, as a CSS colour. */
export const boxColour = (boxId: string): string => `var(--char-${boxColourIndex(boxId)})`;

/** The ring a hand's row leads with, in its box's colour: the pin on the map in
 *  small, so a list of hands reads as the map's own. */
export function boxPin(boxId: string): HTMLElement {
  const ring = document.createElement("i");
  ring.className = "mapside-pin";
  ring.style.borderColor = boxColour(boxId);
  return ring;
}
