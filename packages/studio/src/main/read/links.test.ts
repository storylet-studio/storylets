// The Links lens's read (read/links.ts), headless on a copy of the Village:
// what it says with nothing open, what it says about a card, and how a coverage
// run's evidence lays over the analyser's prediction.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cardNeighbourhood } from "@storylet-studio/ops";
import type { CoverageReport } from "@storylet-studio/ops";
import { openProject } from "../project.js";
import type { ProjectSession } from "../project.js";
import { linksFor } from "./links.js";

const exampleDir = fileURLToPath(new URL("../../../../../examples/the-village.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-links-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const allCards = (s: ProjectSession): { id: string; deck: string }[] =>
  s.loaded.source!.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards.map((c) => ({ id: c.id, deck: d.shard.deck.id }))));

/** A card the analyser gives at least one predecessor. */
function linkedCard(s: ProjectSession): string {
  const found = allCards(s).find((c) => cardNeighbourhood(s.loaded.source!, c.id).predecessors.length > 0);
  if (!found) throw new Error("the Village has no linked card");
  return found.id;
}

const report = (edges: { from: string; to: string; runs: number; count: number }[]): CoverageReport =>
  ({ runs: 40, observedEdges: edges }) as unknown as CoverageReport;

describe("the Links lens", () => {
  it("says there is no project, and carries the window's pin, with nothing open", () => {
    expect(linksFor(undefined, "c_x", undefined, true)).toEqual({
      hasProject: false, card: undefined, predecessors: [], dependents: [], notes: [], pinned: true,
    });
  });

  it("is empty but knows the project when no card is asked about", () => {
    const view = linksFor(scratch(), undefined, undefined, false);
    expect(view.hasProject).toBe(true);
    expect(view.card).toBeUndefined();
    expect(view.predecessors).toEqual([]);
  });

  it("names the card and its neighbours by their deck's title, with no evidence before a run", () => {
    const s = scratch();
    const which = linkedCard(s);
    const view = linksFor(s, which, undefined, false);
    expect(view.card?.id).toBe(which);
    expect(view.predecessors.length).toBeGreaterThan(0);
    const deck = s.loaded.source!.boxes.flatMap((b) => b.decks).find((d) => d.shard.deck.id === view.predecessors[0]!.card!.deck)!;
    expect(view.predecessors[0]!.card!.deckTitle).toBe(deck.shard.deck.title ?? deck.shard.deck.gameId ?? deck.shard.deck.id);
    expect(view.evidence).toBeUndefined();
    expect(view.predecessors.every((p) => p.observed === undefined && p.flagged === undefined)).toBe(true);
  });

  it("lays a run over the prediction: a pair's counts sum and its runs take the most any outcome saw", () => {
    const s = scratch();
    const which = linkedCard(s);
    const from = cardNeighbourhood(s.loaded.source!, which).predecessors[0]!.node!.id;
    const view = linksFor(s, which, {
      report: report([{ from, to: which, runs: 3, count: 4 }, { from, to: which, runs: 5, count: 1 }]),
      at: "2026-10-07T00:00:00.000Z",
    }, false);
    expect(view.evidence).toEqual({ runs: 40, at: "2026-10-07T00:00:00.000Z" });
    expect(view.predecessors.find((p) => p.card?.id === from)?.observed).toEqual({ runs: 5, count: 5 });
  });

  it("flags what the run saw and the analyser did not predict, on the side it was seen", () => {
    const s = scratch();
    const which = linkedCard(s);
    const n = cardNeighbourhood(s.loaded.source!, which);
    const known = new Set([...n.predecessors, ...n.dependents].map((x) => x.node?.id));
    const stranger = allCards(s).find((c) => c.id !== which && !known.has(c.id))!.id;
    const view = linksFor(s, which, { report: report([{ from: stranger, to: which, runs: 2, count: 2 }]), at: "now" }, false);
    const flagged = view.predecessors.filter((p) => p.flagged === true);
    expect(flagged.map((p) => p.card?.id)).toEqual([stranger]);
    expect(flagged[0]).toMatchObject({ cls: "enable", via: [], observed: { runs: 2, count: 2 } });
    expect(view.dependents.some((p) => p.card?.id === stranger)).toBe(false);
  });
});
