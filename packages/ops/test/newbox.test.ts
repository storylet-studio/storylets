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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { runInit } from "../src/init.js";
import { runNewBox } from "../src/newbox.js";
import type { BoxKit } from "../src/newbox.js";
import { runValidate } from "../src/validate.js";
import { isSpatial, polygonOf } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import { Engine } from "@storylet-studio/runtime";
import type { PlannedWrite } from "../src/write.js";

const KITS: BoxKit[] = ["blank", "rpg", "dialogue", "jobs", "stash", "codex", "news", "acts"];

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
    // has no hand must be spoken about somewhere an author will read. The areas
    // are the project map's once the kit lands, so the map's tags count too.
    const source = withKit("rpg").source!;
    const box = source.boxes.at(-1)!;
    const groups = [...box.tags.groups, ...(source.map !== undefined ? [source.map.group] : [])];
    const chosen = new Set(box.hands.hands.flatMap((h) => Object.values(h.chosen ?? {})));
    const orphans = groups.flatMap((g) => g.tags.filter((t) => !chosen.has(t.id)));
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
    // that leaves the map empty teaches that the feature does nothing. A project
    // with no map yet takes the kit's areas AS its map, and the box joins it.
    const source = withKit("rpg").source!;
    const box = source.boxes.at(-1)!;
    expect(box.box.box.usesMap).toBe(true);
    expect(box.tags.groups.some((g) => isSpatial(g))).toBe(false);
    const area = source.map!.group;
    expect(area.gameId).toBe("area");
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

  it("joins the map a project already has, and adds nothing to it", () => {
    // One map per project. A second place-based kit puts its box on the map it
    // finds and leaves the tagging to the author, rather than drawing a second
    // set of areas nobody asked for.
    const dir = fresh("rpg-twice");
    commit(runNewBox({ loaded: loadProject(dir), kit: "rpg" }).writes);
    const before = loadProject(dir).source!.map;
    const writes = runNewBox({ loaded: loadProject(dir), kit: "rpg" }).writes;
    expect(writes.some((w) => w.path === join(dir, "map.storyletmap"))).toBe(false);
    commit(writes);
    const loaded = loadProject(dir);
    expect(loaded.source!.map).toEqual(before);
    const second = loaded.source!.boxes.at(-1)!;
    expect(second.box.box.usesMap).toBe(true);
    // Its own references to the areas it did not get to draw are gone: every
    // group it still names is one of its own.
    const own = new Set(second.tags.groups.map((g) => g.id));
    const named = [
      ...second.hands.templates.flatMap((t) => t.chooses ?? []),
      ...second.hands.hands.flatMap((h) => Object.keys(h.chosen ?? {})),
      ...second.decks.flatMap((d) => d.shard.cards.flatMap((c) => Object.keys(c.tags ?? {}))),
    ];
    expect(named.filter((g) => !own.has(g))).toEqual([]);
    expect(runValidate(loaded, { checkBundle: false }).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The four kits cut from Port Meridian, PLAYED: each tile promises something
// that happens when you deal and play (the kit gallery brief, step 6), so each
// promise is dealt and played through the real engine here, hand by hand.
// ---------------------------------------------------------------------------

/** A flow over a fresh project carrying one kit, with helpers that speak gameIds. */
function playing(kit: BoxKit) {
  const loaded = withKit(kit);
  const bundle = compileProject(loaded.source!).bundle!;
  const flow = new Engine(bundle, { seed: 1 }).openFlow("main");
  const dealt = (hand: string): string[] => flow.deal(hand).map((c) => c.gameId);
  const play = (hand: string, card: string, outcome: string): void => {
    const c = flow.deal(hand).find((x) => x.gameId === card);
    expect(c, `${card} is not in ${hand}`).toBeDefined();
    flow.play(c!.id, outcome, hand);
  };
  return { flow, dealt, play };
}

describe("the Port Meridian kits, played", () => {
  it("Job board: taking a job brings its handoff; finishing it loud brings heat, and lying low sheds it", () => {
    const { dealt, play } = playing("jobs");
    expect(dealt("dockside-board")).toEqual(["cold-delivery"]);
    expect(dealt("old-town-board")).toEqual([]);
    play("dockside-board", "cold-delivery", "take-the-job");
    expect(dealt("dockside-board")).toEqual([]);
    expect(dealt("old-town-board")).toEqual(["cold-delivery-the-handoff"]);
    play("old-town-board", "cold-delivery-the-handoff", "it-went-loud");
    expect(dealt("old-town-board")).toEqual(["lie-low-for-a-night"]);
    play("old-town-board", "lie-low-for-a-night", "lie-low");
    expect(dealt("old-town-board")).toEqual([]);
  });

  it("Stash: each place holds its find, and the decryptor turns up in the back room once the burner phone is taken", () => {
    const { flow, dealt, play } = playing("stash");
    expect(dealt("container-7")).toEqual(["a-dockside-cache"]);
    expect(flow.deal("container-7")[0]!.fields).toEqual({ value: 40 });
    expect(dealt("the-back-room")).toEqual(["a-clean-burner-phone"]);
    play("the-back-room", "a-clean-burner-phone", "pocket-it");
    expect(dealt("the-back-room")).toEqual(["a-military-decryptor"]);
    expect(flow.deal("the-back-room")[0]!.fields).toEqual({ value: 120 });
  });

  it("Codex: the page starts with one entry and grows as leads are followed", () => {
    const { dealt, play } = playing("codex");
    expect(dealt("codex")).toEqual(["port-meridian"]);
    play("leads", "listen-in-on-the-collective", "listen");
    expect(dealt("codex").sort()).toEqual(["port-meridian", "the-grid-collective"]);
    play("leads", "study-the-harbour-charts", "study-them");
    expect(dealt("codex").sort()).toEqual(["port-meridian", "the-grid-collective", "the-harbour"]);
  });

  it("News: the screens run background chatter until something happens, then the story leads", () => {
    const { dealt, play } = playing("news");
    expect(dealt("dock-screen")).toEqual(["acid-drizzle-advisory"]);
    expect(dealt("old-town-screen")).toEqual(["acid-drizzle-advisory"]);
    play("what-happens", "the-lights-go-out", "black-out");
    expect(dealt("old-town-screen").sort()).toEqual(["acid-drizzle-advisory", "rolling-blackouts-hit-the-old-town"]);
    expect(dealt("dock-screen")).toEqual(["acid-drizzle-advisory"]);
  });
});

describe("the Story acts kit, played", () => {
  it("each act's beats wait for it, one beat moves the story on, and the finale waits for the last", () => {
    const { flow, play } = playing("acts");
    const hand = "what-happens-next";
    const now = (): string[] => flow.deal(hand).map((c) => c.gameId).sort();
    expect(now()).toEqual(["a-letter-arrives", "quiet-days"]);
    play(hand, "a-letter-arrives", "read-it");
    expect(now()).toEqual(["a-strangers-warning", "the-road-north"]);
    play(hand, "a-strangers-warning", "heed-it");
    expect(now()).toEqual(["the-reckoning", "the-road-north"]);
  });
});

// ---------------------------------------------------------------------------
// A retitled box keeps its folder (CLI review 2026-10, item 4)
// ---------------------------------------------------------------------------

describe("a new box never lands on a box that is already there", () => {
  /** A project whose second box was made as "New box" and retitled since: its
   *  folder is still `new-box`, and its title no longer says so. */
  function retitled(): string {
    const dir = fresh("retitled");
    commit(runNewBox({ loaded: loadProject(dir) }).writes);
    const boxFile = join(dir, "new-box", "box.storyletbox");
    const box = parseSource(readFileSync(boxFile, "utf8")) as { box: { title: string } };
    box.box.title = "Market";
    writeFileSync(boxFile, canonicalStringify(box));
    return dir;
  }

  it("takes every existing box's FOLDER as taken, not just its address", () => {
    const dir = retitled();
    const before = readFileSync(join(dir, "new-box", "box.storyletbox"), "utf8");
    const result = runNewBox({ loaded: loadProject(dir) });
    expect(result.folder).toBe("new-box-2");
    expect(result.writes.every((w) => !w.path.startsWith(join(dir, "new-box") + sep))).toBe(true);
    commit(result.writes);
    expect(readFileSync(join(dir, "new-box", "box.storyletbox"), "utf8")).toBe(before);
    expect(loadProject(dir).source!.boxes.map((b) => b.path).sort()).toEqual(["main", "new-box", "new-box-2"]);
  });

  it("takes a folder no box loads from (a box's leftovers, say) as taken too", () => {
    const dir = fresh("leftover");
    mkdirSync(join(dir, "new-box"), { recursive: true });
    writeFileSync(join(dir, "new-box", "hands.storylethands"), "{ precious: true }\n");
    expect(runNewBox({ loaded: loadProject(dir) }).folder).toBe("new-box-2");
  });

  it("reuses the folder a deleted box left empty", () => {
    const dir = fresh("emptied");
    mkdirSync(join(dir, "new-box", "decks"), { recursive: true });
    rmSync(join(dir, "new-box", "decks"), { recursive: true });
    expect(runNewBox({ loaded: loadProject(dir) }).folder).toBe("new-box");
  });

  it("refuses rather than overwrite a file that is already there", () => {
    // The project as it was loaded, with a map written since: the kit would
    // make one, and the file it would make is there.
    const dir = fresh("stale");
    const loaded = loadProject(dir);
    writeFileSync(join(dir, "map.storyletmap"), "{ precious: true }\n");
    expect(() => runNewBox({ loaded, kit: "rpg" })).toThrow(/refusing to overwrite/);
    expect(readFileSync(join(dir, "map.storyletmap"), "utf8")).toBe("{ precious: true }\n");
  });
});
