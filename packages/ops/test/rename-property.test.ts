// ---------------------------------------------------------------------------
// A property rename carries every reference (src/rename-property.ts; the
// hands-on review, 2026-10, foundation 4). Worked on the Hamlet fixture, whose
// @story.reputation is read bare and qualified and written by changes, and
// whose debt deck reads and writes its own @deck.debt.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { compileProject, projectDialect } from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { loadProject } from "../src/load.js";
import { setHostScopeDecls } from "@storylet-studio/model";
import { renameProperty, renamePropertyInExpression, renameReferencesInExpression, renameScope } from "../src/rename-property.js";

const exampleDir = fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url));
const fresh = (): SourceProject => loadProject(exampleDir).source!;
const errors = (source: SourceProject): string[] =>
  compileProject(source).issues.filter((i) => i.severity === "error").map((i) => i.message);
/** Every expression and change key in the project, as one string to search. */
const everything = (source: SourceProject): string => JSON.stringify(source.boxes.map((b) => b.decks.map((d) => d.shard)));

describe("renameProperty", () => {
  it("renames a story property in its declaration, every reference and every change key, and the project still compiles", () => {
    const source = fresh();
    const before = everything(source);
    expect(before).toMatch(/@reputation|@story\.reputation/);
    const result = renameProperty(source, { kind: "property", scope: "story", name: "reputation" }, "standing", projectDialect(source))!;
    expect(source.project.story.properties.map((p) => p.name)).toContain("standing");
    expect(source.project.story.properties.map((p) => p.name)).not.toContain("reputation");
    expect(result.project).toBe(true);
    expect(result.expressions + result.values).toBeGreaterThan(0);
    const after = everything(source);
    expect(after).not.toMatch(/@reputation\b|@story\.reputation\b/);
    // The author's own form is kept: bare stays bare, qualified stays qualified.
    expect(after).toMatch(/@standing\b/);
    expect(after).toMatch(/@story\.standing\b/);
    expect(errors(source)).toEqual([]);
  });

  it("renames a deck property only in its own deck", () => {
    const source = fresh();
    const deck = source.boxes.flatMap((b) => b.decks).find((d) => (d.shard.deck.properties ?? []).some((p) => p.name === "debt"))!;
    renameProperty(source, { kind: "property", scope: "deck", name: "debt", deck: deck.shard.deck.id }, "owed", projectDialect(source));
    expect(JSON.stringify(deck.shard)).not.toMatch(/@deck\.debt\b/);
    expect(JSON.stringify(deck.shard)).toMatch(/@deck\.owed\b/);
    expect(errors(source)).toEqual([]);
  });

  it("refuses a name the scope already declares, which would make two properties one", () => {
    const source = fresh();
    const taken = source.project.story.properties.find((p) => p.name !== "reputation")!.name;
    expect(renameProperty(source, { kind: "property", scope: "story", name: "reputation" }, taken, projectDialect(source))).toBeUndefined();
    expect(source.project.story.properties.map((p) => p.name)).toContain("reputation");
  });

  it("carries the references when the declaration was already saved under the new name", () => {
    const source = fresh();
    source.project.story.properties.find((p) => p.name === "reputation")!.name = "standing";
    const result = renameProperty(source, { kind: "property", scope: "story", name: "reputation" }, "standing", projectDialect(source))!;
    expect(result.expressions + result.values).toBeGreaterThan(0);
    expect(everything(source)).not.toMatch(/@reputation\b|@story\.reputation\b/);
    expect(errors(source)).toEqual([]);
  });
});

describe("renamePropertyInExpression", () => {
  const dialect = projectDialect(fresh());
  const story = (scope: string, name: string): boolean => scope === "story" && name === "gold";
  it("keeps the author's text, and leaves a string that mentions the name alone", () => {
    expect(renamePropertyInExpression('@gold >= 3 and @story.gold < 10 and @hand.gold == "@gold"', dialect, story, "coins"))
      .toBe('@coins >= 3 and @story.coins < 10 and @hand.gold == "@gold"');
  });
  it("leaves a longer name that starts the same alone, and answers undefined when nothing refers", () => {
    expect(renamePropertyInExpression("@golden > 1", dialect, story, "coins")).toBeUndefined();
    expect(renamePropertyInExpression("@goldx + @gold", dialect, story, "coins")).toBe("@goldx + @coins");
  });
});

// A host scope renamed (@player to @hero, from Project Settings) carries every
// reference the same way. The fixture is given a second scope, @player, read by
// a card, written by a change and fed by a coverage driver.
describe("renameScope", () => {
  const withPlayer = (bindings = false): SourceProject => {
    const source = fresh();
    setHostScopeDecls(source.project, "player", [
      { name: "hp", type: "number", default: 10 },
      { name: "place", type: "string", default: "village" },
    ]);
    const card = source.boxes[0]!.decks[0]!.shard.cards[0]!;
    card.condition = '@player.hp > 0 and @world.time_of_day == "night"';
    card.outcomes[0]!.changes = { "@player.hp": "@player.hp - 1", ...card.outcomes[0]!.changes };
    if (bindings) {
      source.map!.group.boundBy = "@player.place";
      (source.boxes[0]!.hands.hands[0]! as { chosen?: Record<string, string> }).chosen = { d_zone: "@player.place" };
    }
    source.project.coverage!.drivers!["@player.hp"] = { kind: "initial", values: [3] };
    return source;
  };

  it("renames the scope in the registry and every reference, keeping the property names, and the project still compiles", () => {
    const source = withPlayer();
    expect(errors(source)).toEqual([]);
    const result = renameScope(source, "player", "hero", projectDialect(source))!;
    expect(result).toBeDefined();
    const tokens = source.project.scopeRegistry!.scopes.map((s) => s.token);
    expect(tokens).toContain("hero");
    expect(tokens).not.toContain("player");
    const card = source.boxes[0]!.decks[0]!.shard.cards[0]!;
    expect(card.condition).toBe('@hero.hp > 0 and @world.time_of_day == "night"');
    expect(Object.keys(card.outcomes[0]!.changes!)[0]).toBe("@hero.hp");
    expect(card.outcomes[0]!.changes!["@hero.hp"]).toBe("@hero.hp - 1");
    expect(Object.keys(source.project.coverage!.drivers!)).toEqual(["@world.knows_road", "@world.time_of_day", "@hero.hp"]);
    expect(result.project).toBe(true);
    expect(result.decks.size).toBe(1);
    expect(everything(source)).not.toMatch(/@player\b/);
    expect(errors(source)).toEqual([]);
  });

  it("carries a group's boundBy, the map's included, and a hand's hole", () => {
    // The compiler binds only from @world and @story today, so these are carried for
    // when that widens, not because a project could compile with them now.
    const source = withPlayer(true);
    const result = renameScope(source, "player", "hero", projectDialect(source))!;
    expect(source.map!.group.boundBy).toBe("@hero.place");
    expect((source.boxes[0]!.hands.hands[0]! as { chosen?: Record<string, string> }).chosen).toEqual({ d_zone: "@hero.place" });
    expect(result.map).toBe(true);
    expect(result.hands.size).toBe(1);
  });

  it("refuses a token the project already declares, and changes nothing", () => {
    const source = withPlayer();
    const was = JSON.stringify(source.project);
    expect(renameScope(source, "player", "world", projectDialect(source))).toBeUndefined();
    expect(renameScope(source, "player", "9lives", projectDialect(source))).toBeUndefined();
    expect(renameScope(source, "nobody", "hero", projectDialect(source))).toBeUndefined();
    expect(JSON.stringify(source.project)).toBe(was);
  });

  it("carries the references when the registry was already saved under the new token", () => {
    const source = withPlayer();
    const dialect = projectDialect(source);
    source.project.scopeRegistry!.scopes.find((s) => s.token === "player")!.token = "hero";
    const result = renameScope(source, "player", "hero", dialect)!;
    expect(result.expressions + result.values).toBeGreaterThan(0);
    expect(everything(source)).not.toMatch(/@player\b/);
  });
});

describe("renameReferencesInExpression", () => {
  it("renames a scope, keeping the rest of the author's text and a string that mentions it", () => {
    const source = fresh();
    setHostScopeDecls(source.project, "player", [{ name: "hp", type: "number", default: 10 }]);
    const dialect = projectDialect(source);
    const after = { ...dialect, scopes: [...dialect.scopes, { ...dialect.scopes.find((s) => s.token === "player")!, token: "hero" }] };
    const toHero = (scope: string, name: string) => (scope === "player" ? { scope: "hero", name } : undefined);
    expect(renameReferencesInExpression('@player.hp   >= 3 and @playerx.hp < 1 and "@player.hp" != ""', dialect, toHero, after))
      .toBeUndefined(); // @playerx is no scope: the text doesn't parse, so nothing is touched
    expect(renameReferencesInExpression('@player.hp   >= 3 and @gold < 1 and "@player.hp" != ""', dialect, toHero, after))
      .toBe('@hero.hp   >= 3 and @gold < 1 and "@player.hp" != ""');
  });
});
