// ---------------------------------------------------------------------------
// A box's colour: the one the project map tints its layer, its pins, its chips
// and its navigator glyph with.
//
// Assigned from the curated palette by the box's place in the project, not
// hashed from its name. Every other identity colour in the app is a hash
// (design-language.md: "a hash-selected index into the curated palette"), and
// for decks and tags that is right: there are many, and a stable colour per
// name is worth the odd collision. Boxes are few and sit side by side on one
// map, where a collision is the whole reading lost: Port Meridian's Contracts
// and News hashed to the same colour, and two layers that look alike are one
// layer as far as the eye is concerned. So the first PALETTE_SIZE boxes each
// take a palette slot of their own, which can never collide, and only a box
// beyond it falls back to the hash.
//
// Not the slots in order: the palette is a hue wheel, and neighbouring slots
// (an orange and an ochre) are the next-worst thing to a collision. The order
// below halves, then quarters the wheel, so the first two boxes are opposite
// each other, the first four a quarter turn apart, and so on.
//
// Module state, set by the renderer whenever a project result lands (the same
// shape as views.ts `setCameFrom`): every caller has a box id to hand and
// nothing else, and threading the order through each of them would be a
// parameter none of them decides.
// ---------------------------------------------------------------------------

import { colourIndex, PALETTE_SIZE } from "../../shell/colour.js";

let order: readonly string[] = [];

/** The palette slots in the order boxes take them (PALETTE_SIZE is 12). */
const SPREAD = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11];

/** The project's boxes, in the project's order. */
export function setBoxOrder(boxes: readonly { id: string }[]): void {
  order = boxes.map((b) => b.id);
}

/** The palette index for a box, by id. */
export function boxColourIndex(boxId: string): number {
  const at = order.indexOf(boxId);
  return at >= 0 && at < Math.min(PALETTE_SIZE, SPREAD.length) ? SPREAD[at]! : colourIndex(boxId);
}

/** The same, as a CSS colour. */
export const boxColour = (boxId: string): string => `var(--char-${boxColourIndex(boxId)})`;

/** The ring a site row leads with, in its box's colour: the pin on the map in
 *  small, so a list of sites reads as the map's own. */
export function boxPin(boxId: string): HTMLElement {
  const ring = document.createElement("i");
  ring.className = "mapside-pin";
  ring.style.borderColor = boxColour(boxId);
  return ring;
}
