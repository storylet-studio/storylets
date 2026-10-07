// ---------------------------------------------------------------------------
// The Links lens: one card's neighbourhood, what can open it and what it can
// open, with what the last coverage run actually SAW laid over what the
// analyser predicts (design/graphical-views.md 4).
// ---------------------------------------------------------------------------

import { cardNeighbourhood } from "@storylet-studio/ops";
import type { CoverageReport, InfluenceEdge } from "@storylet-studio/ops";
import { effectiveGameId } from "@storylet-studio/model";
import { linkReasons } from "../link-graph.js";
import type { ProjectSession } from "../project.js";
import type { LinksView } from "../../shared/api.js";

/** A run's evidence: the report, and when it finished. */
export interface CoverageEvidence { report: CoverageReport; at: string }

type CardRef = { id: string; gameId: string; title?: string; deck: string; box: string };

/**
 * The neighbourhood of `which` (the card asked about, or the one the editor
 * has selected), for the Links window. `last` is the last coverage run of the
 * session, when there is one; `pinned` the window's own pin, which rides along.
 */
export function linksFor(
  session: ProjectSession | undefined, which: string | undefined, last: CoverageEvidence | undefined, pinned: boolean,
): LinksView {
  const base: LinksView = {
    hasProject: session !== undefined, card: undefined,
    predecessors: [], dependents: [], notes: [], pinned,
  };
  if (!session || which === undefined) return base;
  // Files are the truth, and a condition edited a second ago should show: the
  // analysis reads the live session, which the write path keeps reloaded.
  const source = session.loaded.source;
  if (!source) return base;
  // Deck titles for the faces: the analyser reports a deck's internal id, and
  // the canvas draws titles (never ids or gameIds).
  const deckTitles = new Map<string, string>();
  for (const box of source.boxes) {
    for (const deck of box.decks) {
      deckTitles.set(deck.shard.deck.id, deck.shard.deck.title ?? deck.shard.deck.gameId ?? deck.shard.deck.id);
    }
  }
  const withDeck = (card: CardRef | undefined): LinksView["card"] =>
    card === undefined ? undefined : { ...card, deckTitle: deckTitles.get(card.deck) ?? card.deck };

  const n = cardNeighbourhood(source, which);
  const asNeighbour = (x: { edge: InfluenceEdge; node: CardRef | undefined }): LinksView["predecessors"][number] => ({
    card: withDeck(x.node),
    cls: x.edge.cls as LinksView["predecessors"][number]["cls"],
    via: linkReasons(x.edge.via),
  });
  // Evidence over inference, when a run exists (design/graphical-views.md 4).
  // Keyed on the PAIR: the report attributes each edge to an outcome too, and
  // several outcomes of the same card can open the same door, so the pair is
  // what a drawn edge means and the counts sum.
  const edges = last?.report.observedEdges;
  const seen = new Map<string, { runs: number; count: number }>();
  for (const e of edges ?? []) {
    const key = `${e.from}\u0000${e.to}`;
    const found = seen.get(key);
    // runs: the most any single outcome was seen in, not the sum. Two
    // outcomes each seen in 30 of 60 runs are not 60 runs' worth of evidence.
    if (found) { found.runs = Math.max(found.runs, e.runs); found.count += e.count; }
    else seen.set(key, { runs: e.runs, count: e.count });
  }
  const observedFor = (from: string | undefined, to: string | undefined): { runs: number; count: number } | undefined =>
    from === undefined || to === undefined ? undefined : seen.get(`${from}\u0000${to}`);

  const predecessors = n.predecessors.map(asNeighbour).map((x) => {
    const o = observedFor(x.card?.id, which);
    return o ? { ...x, observed: o } : x;
  });
  const dependents = n.dependents.map(asNeighbour).map((x) => {
    const o = observedFor(which, x.card?.id);
    return o ? { ...x, observed: o } : x;
  });

  // Flagged: the run saw it and the analyser did not predict it. Two
  // derivations disagreeing means one of them is wrong, which is the whole
  // reason the overlay is worth having.
  const known = new Set([
    ...predecessors.map((x) => `p\u0000${x.card?.id}`),
    ...dependents.map((x) => `d\u0000${x.card?.id}`),
  ]);
  const cardById = new Map(source.boxes.flatMap((box) => box.decks.flatMap((deck) =>
    deck.shard.cards.map((c) => [c.id, { id: c.id, gameId: effectiveGameId(c), ...(c.title !== undefined ? { title: c.title } : {}), deck: deck.shard.deck.id, box: box.box.box.id }] as const))));
  const flagged: LinksView["predecessors"] = [];
  for (const [key, o] of seen) {
    const cut = key.indexOf("\u0000");
    const from = key.slice(0, cut);
    const to = key.slice(cut + 1);
    if (to === which && !known.has(`p\u0000${from}`)) {
      flagged.push({ card: withDeck(cardById.get(from)), cls: "enable", via: [], observed: o, flagged: true });
    }
    if (from === which && !known.has(`d\u0000${to}`)) {
      flagged.push({ card: withDeck(cardById.get(to)), cls: "enable", via: [], observed: o, flagged: true });
    }
  }

  return {
    ...base,
    card: withDeck(n.card),
    predecessors: [...predecessors, ...flagged.filter((f) => seen.get(`${f.card?.id}\u0000${which}`))],
    dependents: [...dependents, ...flagged.filter((f) => seen.get(`${which}\u0000${f.card?.id}`))],
    ...(last !== undefined && last.at
      ? { evidence: { runs: last.report.runs, at: last.at } }
      : {}),
    notes: [...new Set(n.warnings.filter((w) => w.kind === "hand-scope-not-analysed").map((w) => w.message))],
  };
}
