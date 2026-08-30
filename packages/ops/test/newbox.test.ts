// ---------------------------------------------------------------------------
// The starter kits, as a contract.
//
// These had no tests at all, which for CONTENT is worse than for code: a kit is
// the first thing a new author ever sees, and the failure mode is not a crash but
// a project that opens with problems in the bar. Nothing here checks prose; what
// it checks is that each kit lands a project that VALIDATES and COMPILES, that
// applying one twice does not collide, and that each kit actually teaches the
// chapter its blurb in the picker promises.
//
// That last one is the reason this file exists rather than a smoke test. The
// dialogue kit's blurb said it taught copies and the kit had no `copies` anywhere
// in it, which is the kind of thing only an assertion notices - a human reads the
// blurb, reads the kit, and sees what the blurb told them to expect.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInit } from "../src/init.js";
import { runNewBox } from "../src/newbox.js";
import type { BoxKit } from "../src/newbox.js";
import { runValidate } from "../src/validate.js";
import { isSpatial, polygonOf } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import type { PlannedWrite } from "../src/write.js";

const KITS: BoxKit[] = ["blank", "rpg", "dialogue"];

const commit = (writes: PlannedWrite[]): void => {
  for (const w of writes) {
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.content);
  }
};

/** A fresh project on disk, from `init`, with no box added yet. */
function fresh(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `newbox-${label}-`));
  const result = runInit({ dir, name: `Kit ${label}` });
  commit(result.writes);
  return result.dir;
}

/** Apply a kit to a fresh project and hand back what loaded afterwards. */
function withKit(kit: BoxKit): ReturnType<typeof loadProject> {
  const dir = fresh(kit);
  commit(runNewBox({ loaded: loadProject(dir), kit }).writes);
  return loadProject(dir);
}

/**
 * The box the KIT added, which is the last one.
 *
 * Every assertion below has to be scoped to it, and the first draft of this file
 * was not: `init`'s own starter box has a card that writes `@story.started`, so
 * "does any kit teach state?" answered yes about a box no kit had touched. A test
 * that reads the whole project is testing `init` as well, and passing for the
 * wrong reason is the one failure mode a test cannot report.
 */
function kitBox(kit: BoxKit): ReturnType<typeof loadProject>["source"] extends undefined ? never
  : NonNullable<ReturnType<typeof loadProject>["source"]>["boxes"][number] {
  return withKit(kit).source!.boxes.at(-1)!;
}

describe("the starter kits", () => {
  for (const kit of KITS) {
    it(`the ${kit} kit lands a project with nothing to fix`, () => {
      // The bar an author actually meets. A kit that produces a warning is a kit
      // that teaches its first lesson wrong.
      const loaded = withKit(kit);
      expect(loaded.source).toBeDefined();
      const issues = runValidate(loaded, { checkBundle: false }).issues;
      expect(issues.map((i) => `${i.severity} ${i.path}: ${i.message}`)).toEqual([]);
    });
  }

  it("applies the same kit twice without a collision", () => {
    // gameIds are API - deal() and the play log speak them - so two applications
    // of one kit must not mint the same hand or card name twice.
    const dir = fresh("twice");
    commit(runNewBox({ loaded: loadProject(dir), kit: "dialogue" }).writes);
    commit(runNewBox({ loaded: loadProject(dir), kit: "dialogue" }).writes);
    const loaded = loadProject(dir);
    expect(runValidate(loaded, { checkBundle: false }).issues).toEqual([]);
  });

  it("gives every sample card a value for the card template it declares", () => {
    // A box's `fields` ARE the card template: what every card in the box carries.
    // Declaring one and shipping cards that leave it empty teaches that the
    // concept exists and not what it is for, which is the worse half.
    for (const kit of KITS) {
      const box = kitBox(kit);
      const declared = box.box.box.fields.map((f) => f.name);
      for (const deck of box.decks) {
        for (const card of deck.shard.cards) {
          for (const name of declared) {
            expect(card.fields?.[name], `${kit}: card "${card.title}" leaves "${name}" unset`).toBeDefined();
          }
        }
      }
    }
  });

  it("teaches that playing a card changes the world", () => {
    // Every kit shipped outcomes titled "Continue" with `changes: {}`, so a new
    // author could work through all three and never learn that an outcome writes
    // state - the model's central act, and the whole point of the Board. At least
    // one narrated kit has to show it.
    const narrated = KITS.filter((k) => k !== "blank");
    const writes = narrated.filter((kit) =>
      kitBox(kit).decks.some((deck) => deck.shard.cards.some((card) =>
        card.outcomes.some((o) => Object.keys(o.changes ?? {}).length > 0))));
    expect(writes.length, "no narrated kit has an outcome that changes anything").toBeGreaterThan(0);
  });

  it("teaches copies where the picker says it does", () => {
    // The dialogue kit's blurb promises exclusivity AND copies. Exclusivity was
    // taught well (a shared rumour with one copy); `copies` as the deliberate
    // opt-out was promised and absent.
    const cards = kitBox("dialogue").decks.flatMap((d) => d.shard.cards);
    expect(cards.some((c) => (c.copies ?? 1) > 1)).toBe(true);
  });

  it("names every hole it leaves for the author to fill", () => {
    // The rpg kit deliberately instances one of its two areas, so the template
    // has a hole. A hole nobody mentions reads as an oversight, so whatever tag
    // has no hand must be spoken about somewhere an author will read.
    const box = kitBox("rpg");
    const chosen = new Set(box.hands.hands.flatMap((h) => Object.values(h.chosen ?? {})));
    const orphans = box.tags.groups.flatMap((g) => g.tags.filter((t) => !chosen.has(t.id)));
    expect(orphans.length, "the rpg kit is meant to leave one area unseated").toBeGreaterThan(0);
    const prose = [
      ...box.hands.templates.map((t) => t.purpose ?? ""),
      ...box.decks.flatMap((d) => d.shard.cards.map((c) => c.purpose ?? "")),
      box.box.box.purpose ?? "",
    ].join(" ").toLowerCase();
    for (const orphan of orphans) {
      expect(prose, `nothing tells the author about the unseated "${orphan.gameId}"`).toContain(orphan.gameId!);
    }
  });
});

describe("the RPG kit's map", () => {
  it("declares a SPATIAL area group with both zones drawn", () => {
    // A place-based kit whose places are an abstract list teaches half the idea:
    // the Map tab is where an author sees where a card can be dealt, and a kit
    // that leaves the map empty teaches that the feature does nothing.
    const box = kitBox("rpg");
    const area = box.tags.groups.find((g) => g.gameId === "area")!;
    expect(isSpatial(area)).toBe(true);
    // Set-wise: storage is id-sorted (rule 5) and these tags carry no authored
    // `order`, so the stored order is whatever their generated ids sort to.
    expect(area.tags.map((t) => t.gameId).sort()).toEqual(["market", "tavern"]);
    for (const tag of area.tags) {
      const poly = polygonOf(tag);
      expect(poly, `${tag.gameId} has no drawn zone`).toBeDefined();
      expect(poly!.length).toBe(4);
    }
  });
});
