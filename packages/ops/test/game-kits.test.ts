// The game kits `init` starts a project from. The starter is covered by the
// kit tests beside newbox; this holds Map-based Story to the author's
// specification (2026-08-29): one box on a drawn map, ONE starting site that
// opens the others, gates on everything but the starting zone, and scenes and
// conversations that unfold across a couple of sites. Validated, then played.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject } from "@storylet-studio/compiler";
import { Engine } from "@storylet-studio/runtime";
import { isSpatial } from "@storylet-studio/model";
import { GAME_KITS, runInit } from "../src/init.js";
import type { GameKit } from "../src/init.js";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";

function fresh(kit: GameKit): ReturnType<typeof loadProject> {
  const dir = mkdtempSync(join(tmpdir(), `game-kit-${kit}-`));
  const result = runInit({ dir, name: "Kit", kit });
  for (const w of result.writes) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.content); }
  return loadProject(result.dir);
}

describe("the game kits", () => {
  it("offers the starter first", () => {
    expect([...GAME_KITS]).toEqual(["starter", "map-story", "action-game"]);
  });

  for (const kit of GAME_KITS) {
    it(`the ${kit} kit lands a project with nothing to fix`, () => {
      const loaded = fresh(kit);
      expect(loaded.source).toBeDefined();
      expect(runValidate(loaded, { checkBundle: false }).issues.map((i) => `${i.severity} ${i.path}: ${i.message}`)).toEqual([]);
    });
  }
});

describe("Map-based Story", () => {
  it("is one box on a drawn map, with a site in each of three zones", () => {
    const box = fresh("map-story").source!.boxes;
    expect(box).toHaveLength(1);
    const zone = box[0]!.tags.groups.find((g) => g.gameId === "zone")!;
    expect(isSpatial(zone)).toBe(true);
    expect([...zone.tags].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.gameId)).toEqual(["square", "mill", "woods"]);
    const sites = [...box[0]!.hands.hands].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((h) => h.title);
    expect(sites).toEqual(["The well", "The mill race", "The woodcutter's hut"]);
  });

  it("opens the map from the starting site, then unfolds across the others", () => {
    const loaded = fresh("map-story");
    const flow = new Engine(compileProject(loaded.source!).bundle!, { seed: 1 }).openFlow("main");
    const ids = (flow_: typeof flow) => (hand: string): string[] => flow_.deal(hand).map((c) => c.gameId).sort();
    const dealt = ids(flow);
    const handRef = (title: string): string => loaded.source!.boxes[0]!.hands.hands.find((h) => h.title === title)!.id;
    const play = (title: string, card: string, outcome: string): void => {
      const c = flow.deal(handRef(title)).find((x) => x.gameId === card);
      expect(c, `${card} is not at ${title}`).toBeDefined();
      flow.play(c!.id, outcome, handRef(title));
    };

    // Only the starting site has anything to offer, and only the arrival.
    expect(dealt(handRef("The well"))).toEqual(["arrival-at-the-well"]);
    expect(dealt(handRef("The mill race"))).toEqual([]);
    expect(dealt(handRef("The woodcutter's hut"))).toEqual([]);

    // Arriving opens the rest of the map; the woods have a scene at once, the mill waits on a lead.
    play("The well", "arrival-at-the-well", "look-around");
    expect(dealt(handRef("The woodcutter's hut"))).toEqual(["lights-in-the-woods"]);
    expect(dealt(handRef("The mill race"))).toEqual([]);
    expect(dealt(handRef("The well"))).toEqual(["old-nell-at-the-well"]);

    // Nell's rumour brings the mill's scene; freeing the wheel brings the miller.
    play("The well", "old-nell-at-the-well", "ask-about-the-mill");
    expect(dealt(handRef("The mill race"))).toEqual(["the-wheel-has-stopped"]);
    play("The mill race", "the-wheel-has-stopped", "free-the-wheel");
    expect(dealt(handRef("The mill race"))).toEqual(["the-millers-thanks"]);
  });
});

describe("Action game", () => {
  it("is five boxes on one shared district map, talking only through @story", () => {
    const boxes = fresh("action-game").source!.boxes;
    expect(boxes.map((b) => b.box.box.gameId).sort()).toEqual(["codex", "contracts", "encounters", "items", "news"]);
    for (const b of boxes.filter((x) => x.box.box.gameId !== "codex")) {
      const d = b.tags.groups.find((g) => g.gameId === "district")!;
      expect(isSpatial(d), `${b.box.box.gameId} has no map`).toBe(true);
      expect(d.tags.map((t) => t.gameId).sort()).toEqual(["docks", "old-town"]);
    }
  });

  it("carries a job's consequences across the boxes: heat to the streets, the wire to the screens, the record to the codex", () => {
    const loaded = fresh("action-game");
    const flow = new Engine(compileProject(loaded.source!).bundle!, { seed: 1 }).openFlow("main");
    const now = (hand: string): string[] => flow.deal(hand).map((c) => c.gameId).sort();
    const play = (hand: string, card: string, outcome: string): void => {
      const c = flow.deal(hand).find((x) => x.gameId === card);
      expect(c, `${card} is not in ${hand}`).toBeDefined();
      flow.play(c!.id, outcome, hand);
    };

    expect(now("codex")).toEqual(["the-city"]);
    expect(now("dockside-streets")).toEqual(["pickpocket"]);
    expect(now("dock-screen")).toEqual(["acid-drizzle-advisory"]);

    play("dockside-board", "cold-delivery", "take-the-job");
    play("old-town-board", "cold-delivery-the-handoff", "it-went-loud");
    // Heat brings the checkpoint, which outranks the pickpocket for the street's one slot once dealt fresh.
    expect(now("old-town-streets")).toEqual(["checkpoint"]);
    // The wire puts the raid on every screen, over the chatter.
    expect(now("dock-screen")).toEqual(["acid-drizzle-advisory", "container-yard-raided"]);
    // The contracts board's record unlocks a codex entry; the stash's find unlocks another.
    play("the-back-room", "a-clean-burner-phone", "pocket-it");
    expect(now("codex")).toEqual(["burner-networks", "the-city", "the-syndicate"]);

    // The news cycle: the GAME clears the wire and re-deals, and the story leaves the screens.
    flow.setProperty("story.wire", []);
    expect(now("dock-screen")).toEqual(["acid-drizzle-advisory"]);
  });
});
