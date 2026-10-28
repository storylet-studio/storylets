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
import { renameProperty, renamePropertyInExpression } from "../src/rename-property.js";

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
