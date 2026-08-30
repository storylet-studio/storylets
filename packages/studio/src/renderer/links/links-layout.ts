// ---------------------------------------------------------------------------
// Where the Links canvas puts things: the focus card in the middle, what reaches
// it on the left, what it reaches on the right. Unreal's References viewer, in
// the vocabulary the node view already uses (design/graphical-views.md section 4).
//
// A GENERATED arrangement, not an authored one. The node canvas remembers where
// an author dragged a card; this one is recomputed from the graph every time the
// focus moves, so there is nothing to persist and nothing to drag. That is the
// whole difference between the two canvases: same surface, same faces, same edge
// inks, but here the layout is the answer rather than the author's.
//
// Pure, so it can be tested without a canvas.
// ---------------------------------------------------------------------------

export interface LinksLayoutOptions {
  width: number;
  height: number;
  /** Between a column and the next. */
  gapX?: number;
  /** Between two cards in the same column. */
  gapY?: number;
}

export interface LinksPlacement {
  id: string;
  x: number;
  y: number;
}

export interface LinksLayout {
  placements: LinksPlacement[];
  /** Where each column's caption sits: above the column, in world coordinates. */
  captions: { text: string; x: number; y: number; width: number }[];
  /** The room the captions need OUTSIDE the cards, handed to the surface as its
   *  fit margin. A fit frames items, and captions are backdrop, so without this
   *  they are framed off the edge of the pane: a tall column loses its headings
   *  off the top, and an EMPTY column is worse, because the cards no longer reach
   *  that side at all and its caption ends up half off the window with nothing to
   *  explain it. Derived from where the captions actually are, so it cannot drift
   *  from the drawing. */
  fitMargin: { top: number; left: number; right: number };
}

/** The gap from a caption's top to the top of the tallest column. */
const CAPTION_BAND = 44;

/**
 * Lay out one hop around a focus card.
 *
 * Each column is centred vertically on the focus, so the eye starts in the middle
 * and reads outwards, and the focus stays put as the neighbour counts change: a
 * card with one predecessor and a card with nine both sit in the same place, which
 * matters when you are walking a graph and the view is re-generated at every step.
 */
export function linksLayout(
  focus: string, reaching: string[], reached: string[], opts: LinksLayoutOptions,
): LinksLayout {
  const gapX = opts.gapX ?? 150;
  const gapY = opts.gapY ?? 26;
  const step = opts.height + gapY;
  const column = opts.width + gapX;

  /** A column's cards, centred on y = 0. */
  const stack = (ids: string[], x: number): LinksPlacement[] =>
    ids.map((id, i) => ({
      id,
      x,
      y: (i - (ids.length - 1) / 2) * step,
    }));

  const placements = [
    ...stack(reaching, -column),
    { id: focus, x: 0, y: 0 },
    ...stack(reached, column),
  ];

  // Captions ride at fixed world positions above the columns rather than in the
  // DOM: they belong to the columns, so they should pan and zoom with them.
  const tallest = Math.max(reaching.length, reached.length, 1);
  const top = -((tallest - 1) / 2) * step - CAPTION_BAND;
  const captions: LinksLayout["captions"] = [
    { text: captionFor("reaching", reaching.length), x: -column, y: top, width: opts.width },
    { text: "This card", x: 0, y: top, width: opts.width },
    { text: captionFor("reached", reached.length), x: column, y: top, width: opts.width },
  ];

  // What the cards occupy horizontally, against what the captions do.
  const cardLeft = Math.min(...placements.map((p) => p.x));
  const cardRight = Math.max(...placements.map((p) => p.x + opts.width));
  const capLeft = Math.min(...captions.map((c) => c.x));
  const capRight = Math.max(...captions.map((c) => c.x + c.width));

  return {
    placements,
    captions,
    fitMargin: {
      top: CAPTION_BAND,
      left: Math.max(0, cardLeft - capLeft),
      right: Math.max(0, capRight - cardRight),
    },
  };
}

/** The column headings. Each names the CARDS IN THAT COLUMN, which is what a
 *  column heading is for, and both sides use the same verb so the two directions
 *  read as one relationship seen from either end.
 *
 *  "Reaches" was tried first and was not clear: it says something arrives without
 *  saying what, and "this card reaches" could be read as either direction. */
function captionFor(side: "reaching" | "reached", count: number): string {
  if (side === "reaching") {
    return count === 0 ? "Nothing affects this card" : `Affects this card (${count})`;
  }
  return count === 0 ? "This card affects nothing" : `Affected by this card (${count})`;
}
