// ---------------------------------------------------------------------------
// planPins: pin on publish (design/pin-on-publish.md in the workshop repo).
// Expectations hand-written from the Hamlet fixture: one deck there still
// follows its title, and a copy with further addresses cleared exercises every
// kind that can be pinned, the untitled draft that must not be, and the rule
// that the value written is the address the item already had.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import type { BoxShard, DeckShard, HandsShard } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { planPins } from "../src/pin.js";

const exampleDir = fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url));

/** A scratch copy of the fixture, with `edit` applied to shards through the
 *  parser (never a regex over the text). */
function copyWith(edit: (dir: string) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pin-")), "the-hamlet.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  edit(dir);
  return dir;
}
function rewrite<T>(path: string, change: (shard: T) => void): void {
  const shard = parseSource(readFileSync(path, "utf8")) as T;
  change(shard);
  writeFileSync(path, canonicalStringify(shard));
}

/** The fixture with a box, a card, an outcome, a hand and the untitled hand
 *  template all following their titles again. */
const unpinned = (): string => copyWith((dir) => {
  rewrite<BoxShard>(join(dir, "village/box.storyletbox"), (s) => { delete s.box.gameId; });
  rewrite<DeckShard>(join(dir, "village/decks/ambients.storyletdeck"), (s) => {
    delete s.cards.find((c) => c.id === "c_amb_market")!.gameId;
    delete s.cards.find((c) => c.id === "c_road_north")!.outcomes[0]!.gameId;
  });
  rewrite<HandsShard>(join(dir, "village/hands.storylethands"), (s) => {
    delete s.hands.find((h) => h.id === "h_inn")!.gameId;
    delete s.templates.find((t) => t.id === "t_whats_happening")!.gameId;
  });
});

describe("planPins", () => {
  it("pins the one deck in the fixture still following its title, and writes only that line", () => {
    const loaded = loadProject(exampleDir);
    const plan = planPins(loaded);
    expect(plan.pinned).toEqual([{ id: "k_gareth", kind: "deck", gameId: "gareths-debt" }]);
    expect(plan.writes.map((w) => w.path.slice(exampleDir.length + 1))).toEqual(["village/decks/gareths-debt.storyletdeck"]);
    const before = readFileSync(plan.writes[0]!.path, "utf8").split("\n");
    const added = plan.writes[0]!.content.split("\n").filter((l) => !before.includes(l));
    expect(added).toEqual(['    gameId: "gareths-debt",']);
  });

  it("pins every titled kind, one write per touched shard, at the address it already had", () => {
    const dir = unpinned();
    const plan = planPins(loadProject(dir));
    expect(plan.pinned.map((p) => [p.kind, p.id, p.gameId]).sort()).toEqual([
      ["box", "b_village", "village"],
      ["card", "c_amb_market", "market-bustle"],
      ["deck", "k_gareth", "gareths-debt"],
      ["hand", "h_inn", "the-inn"],
      ["outcome", "c_road_north_o", "follow-it-a-little-way"],
    ]);
    expect(plan.writes.map((w) => w.path.slice(dir.length + 1)).sort()).toEqual([
      "village/box.storyletbox",
      "village/decks/ambients.storyletdeck",
      "village/decks/gareths-debt.storyletdeck",
      "village/hands.storylethands",
    ]);
  });

  it("leaves an untitled draft following its id, and an address already pinned alone", () => {
    const dir = unpinned();
    const plan = planPins(loadProject(dir));
    // The hand template has no title: pinning would freeze its raw id.
    expect(plan.pinned.some((p) => p.id === "t_whats_happening")).toBe(false);
    const hands = parseSource(plan.writes.find((w) => w.path.endsWith("hands.storylethands"))!.content) as HandsShard;
    expect(hands.templates.find((t) => t.id === "t_whats_happening")!.gameId).toBeUndefined();
    // A pinned address that differs from its title is kept as it is.
    expect(hands.hands.find((h) => h.id === "h_tree")!.gameId).toBe("the-mystic-tree");
  });

  it("treats a blank gameId as not pinned", () => {
    const dir = copyWith((d) => rewrite<DeckShard>(join(d, "village/decks/ambients.storyletdeck"), (s) => {
      s.cards.find((c) => c.id === "c_amb_market")!.gameId = "  ";
    }));
    expect(planPins(loadProject(dir)).pinned).toContainEqual({ id: "c_amb_market", kind: "card", gameId: "market-bustle" });
  });

  it("changes no name in the bundle, and has nothing left to do once applied", () => {
    const dir = unpinned();
    const names = (d: string): unknown => {
      const { bundle } = compileProject(loadProject(d).source!);
      return bundle!.boxes.map((b) => [b.gameId, b.decks.map((k) => [k.gameId, k.cards.map((c) => [c.gameId, c.outcomes.map((o) => o.gameId)])]), b.hands.map((h) => h.gameId)]);
    };
    const before = names(dir);
    for (const w of planPins(loadProject(dir)).writes) writeFileSync(w.path, w.content);
    expect(names(dir)).toEqual(before);
    expect(planPins(loadProject(dir))).toEqual({ pinned: [], writes: [] });
  });
});
