// ---------------------------------------------------------------------------
// A box's colour on the project map: STORED, not computed (the surfacing
// review's round-3 ruling, design/surfacing-review-2026-10/README.md).
//
// It used to be worked out from the box's place in the project, which had
// three faults the antagonist review named: a box off the map still took a
// slot, so two of Port Meridian's four layers came out as neighbouring hues;
// reordering the boxes, or adding one above, recoloured every layer; and the
// Board, a different window, never knew. Colour is the only thing telling the
// author whose pin a dot is, so it has to stay put.
//
// So a box keeps the colour it is given, in its view sidecar (model
// `ViewShard.colour`, editor-only and never compiled), and project order
// decides only the FIRST assignment: when a box joins the map, and once for
// every box already on it when the map is first drawn after this change.
//
// WHICH colour: the first slot, in `COLOUR_ORDER`, that no other box ON THE MAP
// uses. Not the slots in palette order: the palette is a hue wheel, and
// neighbouring slots (an orange and an ochre) are the next-worst thing to a
// collision, so the order halves the wheel, then quarters it, and the first
// two boxes come out opposite each other. Past twelve boxes on one map a slot
// has to be shared, and the least-used one goes first.
// ---------------------------------------------------------------------------

import { boxColourOf, planBoxColour } from "@storylet-studio/ops";
import type { SourceBox } from "@storylet-studio/compiler";
import { VIEW_SCHEMA } from "@storylet-studio/model";
import type { FileState } from "./history.js";
import type { ProjectSession } from "./project.js";
import { byDisplay } from "./project.js";

/** The identity palette's slots (app-shell PALETTE_SIZE), in the order boxes take them. */
export const COLOUR_ORDER: readonly number[] = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11];

/** The slot a box joining the map takes, given the slots the boxes already on
 *  it use (repeats count, for the twelve-plus case). */
export function nextColour(taken: readonly number[]): number {
  const uses = (c: number): number => taken.filter((t) => t === c).length;
  let best = COLOUR_ORDER[0]!;
  for (const c of COLOUR_ORDER) if (uses(c) < uses(best)) best = c;
  return best;
}

/** The boxes on the project map, in the project's display order. */
export function boxesOnMap(session: ProjectSession): SourceBox[] {
  const source = session.loaded.source;
  if (!source || source.map === undefined) return [];
  return byDisplay(source.boxes.map((b, i) => ({ b, order: b.box.box.order ?? i })))
    .map(({ b }) => b)
    .filter((b) => b.box.box.usesMap === true);
}

/**
 * The colour a box should take as it joins the map: the one it already has,
 * unless another box on the map uses it (a box that left and came back while
 * somebody else took its colour), else the next free slot.
 */
export function joiningColour(session: ProjectSession, box: SourceBox): number {
  const others = boxesOnMap(session).filter((b) => b !== box).map((b) => boxColourOf(b)).filter((c): c is number => c !== undefined);
  const own = boxColourOf(box);
  return own !== undefined && !others.includes(own) ? own : nextColour(others);
}

/** The write that stores `colour` for `box`, applied to the in-memory shard
 *  too, so the DTOs built straight after it carry the colour. */
export function colourWrite(session: ProjectSession, box: SourceBox, colour: number): FileState | undefined {
  const planned = planBoxColour(session.loaded.dir, box, colour);
  if (planned === undefined) return undefined;
  box.view = { ...box.view, schema: VIEW_SCHEMA, colour };
  return { path: planned.path, content: planned.content };
}

/**
 * Give every box on the map that has no colour yet its colour, in project
 * order, and write each one ONCE. The writes that need making, for the caller
 * to apply: empty, which is every call but the first, when every box already
 * has one.
 */
export function missingColours(session: ProjectSession): FileState[] {
  const on = boxesOnMap(session);
  const taken = on.map((b) => boxColourOf(b)).filter((c): c is number => c !== undefined);
  const writes: FileState[] = [];
  for (const box of on) {
    if (boxColourOf(box) !== undefined) continue;
    const colour = nextColour(taken);
    taken.push(colour);
    const w = colourWrite(session, box, colour);
    if (w) writes.push(w);
  }
  return writes;
}
