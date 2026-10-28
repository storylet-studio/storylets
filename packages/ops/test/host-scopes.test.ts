// ---------------------------------------------------------------------------
// Host scopes like Patter's (`@player` beside `@world`) in the authoring
// analyses: the Links window's influence graph, "where is it used", and a
// property or stage renamed. Each one used to know only `@world` (a fixed set
// of scopes), so a read of `@player.hp` was no property at all.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { projectDialect } from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { setHostScopeDecls } from "@storylet-studio/model";
import { analyseInfluence } from "../src/influence.js";
import { loadProject } from "../src/load.js";
import { renameProperty } from "../src/rename-property.js";
import { locate, renameStage } from "../src/stages.js";
import { parsePropertyQuery, runPropertyUsage } from "../src/usage.js";

const exampleDir = fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url));

/** The Hamlet with an @player scope (hp, and a mood quality), the arrival card reading both and
 *  its outcome writing hp, and the mysterious figure's card reading hp. */
function withPlayer() {
  const loaded = loadProject(exampleDir);
  const source = loaded.source!;
  setHostScopeDecls(source.project, "player", [
    { name: "hp", type: "number", default: 10 },
    { name: "mood", type: "quality", stages: ["calm", "tense"], default: "calm" },
  ]);
  const cards = source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards));
  const arrive = cards.find((c) => c.id === "c_arrive")!;
  arrive.condition = '@player.mood >= "calm"';
  arrive.outcomes[0]!.changes = { ...arrive.outcomes[0]!.changes, "@player.hp": "@player.hp + 1" };
  const reader = cards.find((c) => c.id === "c_amb_night")!;
  reader.condition = "@player.hp > 10";
  return { loaded, source, arrive, reader };
}

describe("host scopes in the influence graph", () => {
  it("links a card writing @player.hp up to one that wants it high", () => {
    const { source } = withPlayer();
    const g = analyseInfluence(source as SourceProject);
    const e = g.edges.find((x) => x.from === "c_arrive" && x.to === "c_amb_night");
    expect(e?.cls).toBe("enable");
    expect(e?.via.map((v) => v.property)).toContain("@player.hp");
  });
});

describe("host scopes in usage", () => {
  it("reads a host token as a scope where the project declares it, and not otherwise", () => {
    expect(parsePropertyQuery("@player.hp", new Set(["player"]))).toEqual({ scope: "player", name: "hp" });
    expect(parsePropertyQuery("@player.hp")).toBeNull();
    expect(parsePropertyQuery("@player.x.hp", new Set(["player"]))).toBeNull();   // no container on a host scope
  });

  it("finds every read and write of @player.hp", () => {
    const { loaded } = withPlayer();
    const hits = runPropertyUsage(loaded, "@player.hp").map((h) => [h.use, h.item.id]);
    expect(hits).toContainEqual(["read", "c_amb_night"]);
    expect(hits).toContainEqual(["write", "c_arrive_o"]);
  });
});

describe("host scopes in renames", () => {
  it("locates a @player declaration", () => {
    const { source } = withPlayer();
    expect(locate(source, { kind: "property", scope: "player", name: "hp" })?.decl.name).toBe("hp");
    expect(locate(source, { kind: "property", scope: "player", name: "nope" })).toBeUndefined();
  });

  it("renames @player.hp where it is read and written", () => {
    const { source, arrive, reader } = withPlayer();
    const r = renameProperty(source, { kind: "property", scope: "player", name: "hp" }, "health", projectDialect(source));
    expect(r?.project).toBe(true);
    expect(reader.condition).toBe("@player.health > 10");
    expect(arrive.outcomes[0]!.changes["@player.health"]).toBe("@player.health + 1");
  });

  it("renames a @player quality's stage in the literals naming it", () => {
    const { source, arrive } = withPlayer();
    const r = renameStage(source, { kind: "property", scope: "player", name: "mood" }, "calm", "serene", projectDialect(source));
    expect(r?.expressions).toBe(1);
    expect(arrive.condition).toBe('@player.mood >= "serene"');
  });
});
