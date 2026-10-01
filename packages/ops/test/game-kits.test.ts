// The game kits `init` starts a project from. The starter is covered by the
// kit tests beside newbox; this holds Map-based Story to the author's
// specification (2026-08-29): one box on a drawn map, ONE starting site that
// opens the others, gates on everything but the starting zone, and scenes and
// conversations that unfold across a couple of sites. Validated, then played.
// Both map kits are cut on the PROJECT map (design/project-map-contract.md): the
// zone group is the root map shard's, and a box joins it with `usesMap`.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject } from "@storylet-studio/compiler";
import { Engine } from "@storylet-studio/runtime";
import { isSpatial } from "@storylet-studio/model";
import { boxMap } from "../src/map.js";
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
  it("is one box on a drawn map, with a site for each of three places across two regions", () => {
    const source = fresh("map-story").source!;
    const box = source.boxes;
    expect(box).toHaveLength(1);
    expect(box[0]!.box.box.usesMap).toBe(true);
    // The map is the project's, so the box's own tags carry no zone group.
    expect(box[0]!.tags.groups.some((g) => isSpatial(g))).toBe(false);
    const region = source.map!.group;
    expect(region.gameId).toBe("region");
    expect(isSpatial(region)).toBe(true);
    expect([...region.tags].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.gameId)).toEqual(["village", "woods"]);
    const hands = [...box[0]!.hands.hands].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(hands.map((h) => h.title)).toEqual(["The well", "The mill race", "The woodcutter's hut"]);
    // Every place stands somewhere: a site each, in the box's own map shard.
    expect(Object.keys(boxMap(box[0]!).sites ?? {}).sort()).toEqual(hands.map((h) => h.id).sort());
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
    const source = fresh("action-game").source!;
    const boxes = source.boxes;
    expect(boxes.map((b) => b.box.box.gameId).sort()).toEqual(["codex", "contracts", "encounters", "items", "news"]);
    // One district map, the project's: one set of districts every box shares.
    const d = source.map!.group;
    expect(d.gameId).toBe("district");
    expect(isSpatial(d)).toBe(true);
    expect(d.tags.map((t) => t.gameId).sort()).toEqual(["docks", "old-town"]);
    for (const b of boxes) {
      const onMap = b.box.box.gameId !== "codex";
      expect(b.box.box.usesMap === true, `${b.box.box.gameId} ${onMap ? "is not on" : "should not be on"} the map`).toBe(onMap);
      expect(b.tags.groups.some((g) => g.gameId === "district"), `${b.box.box.gameId} keeps its own district group`).toBe(false);
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
