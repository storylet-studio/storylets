// ---------------------------------------------------------------------------
// The influence analysis, projected into the shapes the two link canvases draw.
//
// Out of index.ts so it can be tested without Electron: the IPC handlers there
// fetch the source and the coverage report, and these decide what an edge
// carries. Both canvases now read an edge's reasons (a hovered arrow says why it
// exists), so the projection is worth pinning rather than trusting.
// ---------------------------------------------------------------------------

import type { EdgeContribution, InfluenceEdge } from "@storylet-studio/ops";
import type { GraphEdge, LinkReason } from "../shared/api.js";

/** The analyser's own fields, passed straight through: the renderer phrases and
 *  typesets them. It does not reason about them, and a joined sentence would
 *  take away the only thing it can add. */
export function linkReasons(via: readonly EdgeContribution[]): LinkReason[] {
  return via.map((v) => ({
    property: v.property, ...(v.flag ? { flag: v.flag } : {}),
    ...(v.outcome ? { outcome: v.outcome } : {}), ...(v.note ? { note: v.note } : {}),
  }));
}

/** A deck's edges: those with BOTH ends among its cards, with their reasons,
 *  and a count of the rest that touch it, because a deck with no internal links
 *  is perfectly normal and its canvas has to be able to say so. */
export function deckEdges(
  edges: readonly InfluenceEdge[], cardIds: ReadonlySet<string>,
): { edges: GraphEdge[]; outside: number } {
  const inside: GraphEdge[] = [];
  let outside = 0;
  for (const edge of edges) {
    const from = cardIds.has(edge.from);
    const to = cardIds.has(edge.to);
    if (from && to) inside.push({ from: edge.from, to: edge.to, cls: edge.cls, via: linkReasons(edge.via) });
    else if (from || to) outside++;
  }
  return { edges: inside, outside };
}
