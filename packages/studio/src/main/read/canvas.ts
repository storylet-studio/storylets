// ---------------------------------------------------------------------------
// What a deck's node canvas draws: where its cards sit, the edges between
// them, and its frames.
// ---------------------------------------------------------------------------

import { analyseInfluence, canvasFurniture, cardPositions } from "@storylet-studio/ops";
import type { Frame } from "@storylet-studio/model";
import { deckEdges } from "../link-graph.js";
import type { ProjectSession } from "../project.js";
import type { CanvasFurnitureDto, DeckGraph } from "../../shared/api.js";

/** Furniture as the renderer sees it. The model's reader has already dropped
 *  anything malformed and put the rest in draw order; this only widens the
 *  optional keys into the DTO's shape. */
export function furnitureDto(furniture: { frames?: Frame[] }): CanvasFurnitureDto {
  return { frames: (furniture.frames ?? []).map((r) => ({ ...r })) };
}

/**
 * The node view's edges (#56). One analysis of the whole project, partitioned
 * by whether an edge's ends are both in this deck, because the OUTSIDE count
 * is as load-bearing as the inside edges: a deck with no internal links is
 * perfectly normal (its cards answer to cards elsewhere), and a canvas that
 * only looked empty would read as broken. A second pass at deck scope would
 * just re-derive what this one already knows.
 */
export function deckGraph(session: ProjectSession | undefined, deckId: string): DeckGraph {
  const base: DeckGraph = {
    hasProject: session !== undefined, positions: {}, edges: [], outsideLinks: 0,
    furniture: { frames: [] }, notes: [],
  };
  const source = session?.loaded.source;
  if (!source) return base;
  // The owning box, not just the deck: the arrangement lives in the box's
  // sidecar, so the canvas needs both.
  const box = source.boxes.find((b) => b.decks.some((d) => d.shard.deck.id === deckId));
  const deck = box?.decks.find((d) => d.shard.deck.id === deckId);
  if (!box || !deck) return base;
  const mine = new Set(deck.shard.cards.map((c) => c.id));
  const graph = analyseInfluence(source);
  // With their reasons: a hovered arrow says why it is there.
  const { edges, outside } = deckEdges(graph.edges, mine);
  return {
    ...base,
    // Where the author has put things. Sparse: the view lays out the rest.
    positions: cardPositions(box, deckId),
    furniture: furnitureDto(canvasFurniture(box, { kind: "deck", deck: deckId })),
    edges,
    outsideLinks: outside,
    notes: [...new Set(graph.warnings.filter((w) => w.kind === "hand-scope-not-analysed").map((w) => w.message))],
  };
}
