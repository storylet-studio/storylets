// ---------------------------------------------------------------------------
// A stage rename carries every value and literal naming the stage; a reorder
// is counted in gates (src/stages.ts, patterkit design/proposals/
// patter-qualities.md section 2). Worked on the Hamlet fixture: @story.act is
// arrival, act-1, act-2, and the debt deck's @deck.debt starts quiet.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { compileProject, projectDialect } from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { loadProject } from "../src/load.js";
import { renameStage, stageGateCount } from "../src/stages.js";

const exampleDir = fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url));
const fresh = (): SourceProject => loadProject(exampleDir).source!;
const errors = (source: SourceProject): string[] =>
  compileProject(source).issues.filter((i) => i.severity === "error").map((i) => i.message);
const conditions = (source: SourceProject): string[] =>
  source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards.map((c) => c.condition ?? "")));

describe("renameStage", () => {
  it("renames a story quality's stage in its declaration and every gate, and the project still compiles", () => {
    const source = fresh();
    const result = renameStage(source, { kind: "property", scope: "story", name: "act" }, "act-1", "first-act", projectDialect(source))!;
    const decl = source.project.story.properties.find((p) => p.name === "act")!;
    expect(decl.stages).toEqual(["arrival", "first-act", "act-2"]);
    expect(result.project).toBe(true);
    expect(result.expressions).toBe(3);
    expect(conditions(source).filter((c) => c.includes('"first-act"'))).toHaveLength(3);
    expect(conditions(source).join()).not.toContain('"act-1"');
    expect(errors(source)).toEqual([]);
  });

  it("carries the default when the renamed stage is where the quality starts", () => {
    const source = fresh();
    renameStage(source, { kind: "property", scope: "story", name: "act" }, "arrival", "prologue", projectDialect(source));
    const decl = source.project.story.properties.find((p) => p.name === "act")!;
    expect(decl.default).toBe("prologue");
    expect(conditions(source)).toContain('@act == "prologue"');
    expect(errors(source)).toEqual([]);
  });

  it("keeps a deck quality's rename inside its deck", () => {
    const source = fresh();
    const box = source.boxes[0]!;
    const debt = box.decks.find((d) => d.shard.deck.properties?.some((p) => p.name === "debt"))!;
    const result = renameStage(source, { kind: "property", scope: "deck", deck: debt.shard.deck.id, name: "debt" }, "quiet", "hushed", projectDialect(source))!;
    expect([...result.decks]).toEqual([debt]);
    expect(debt.shard.deck.properties!.find((p) => p.name === "debt")!.default).toBe("hushed");
    expect(errors(source)).toEqual([]);
  });

  it("carries the values when the declaration was already saved with the new name", () => {
    const source = fresh();
    const decl = source.project.story.properties.find((p) => p.name === "act")!;
    decl.stages = ["arrival", "first-act", "act-2"];
    const result = renameStage(source, { kind: "property", scope: "story", name: "act" }, "act-1", "first-act", projectDialect(source))!;
    expect(result.project).toBe(false);
    expect(result.expressions).toBe(3);
    expect(errors(source)).toEqual([]);
  });

  it("carries a coverage driver's values for the quality", () => {
    const source = fresh();
    source.project.coverage = { drivers: { "@story.act": { kind: "recurring", values: ["arrival", "act-1"] } } };
    const result = renameStage(source, { kind: "property", scope: "story", name: "act" }, "act-1", "first-act", projectDialect(source))!;
    expect(source.project.coverage.drivers!["@story.act"]!.values).toEqual(["arrival", "first-act"]);
    expect(result.project).toBe(true);
  });

  it("refuses a target that is not a quality, a stage it does not have, or a name already taken", () => {
    const source = fresh();
    const dialect = projectDialect(source);
    const act = { kind: "property" as const, scope: "story" as const, name: "act" };
    expect(renameStage(source, act, "finale", "x", dialect)).toBeUndefined();
    expect(renameStage(source, act, "act-1", "act-2", dialect)).toBeUndefined();
    expect(renameStage(source, act, "act-1", "  ", dialect)).toBeUndefined();
    expect(renameStage(source, { kind: "property", scope: "story", name: "nothing" }, "a", "b", dialect)).toBeUndefined();
  });

  it("carries a quality field's values on cards, and an outcome field's on outcomes", () => {
    const source = fresh();
    const box = source.boxes[0]!;
    box.box.box.fields = [...box.box.box.fields, { name: "beat", type: "quality", default: "open", stages: ["open", "turn", "close"] }];
    box.box.box.outcomeFields = [{ name: "tone", type: "quality", default: "calm", stages: ["calm", "sharp"] }];
    const card = box.decks[0]!.shard.cards[0]!;
    card.fields = { ...card.fields, beat: "turn" };
    card.outcomes[0]!.fields = { tone: "sharp" };
    const dialect = projectDialect(source);
    const beat = renameStage(source, { kind: "field", box: box.box.box.id, template: "fields", name: "beat" }, "turn", "pivot", dialect)!;
    expect(card.fields?.["beat"]).toBe("pivot");
    expect(beat.values).toBe(1);
    expect(beat.boxes.has(box)).toBe(true);
    expect(beat.decks.has(box.decks[0]!)).toBe(true);
    renameStage(source, { kind: "field", box: box.box.box.id, template: "outcomeFields", name: "tone" }, "sharp", "keen", dialect);
    expect(card.outcomes[0]!.fields).toEqual({ tone: "keen" });
    expect(errors(source)).toEqual([]);
  });

  it("carries a tag group quality's starting values on its tags", () => {
    const source = fresh();
    const box = source.boxes[0]!;
    const group = { id: "d_moods", gameId: "moods", properties: [{ name: "mood", type: "quality" as const, default: "calm", stages: ["calm", "uneasy"] }],
      tags: [{ id: "v_cellar", gameId: "cellar", values: { mood: "uneasy" } as Record<string, string> }] };
    box.tags.groups.push(group as never);
    const result = renameStage(source, { kind: "property", scope: "hand", holder: group.id, name: "mood" }, "uneasy", "tense", projectDialect(source))!;
    expect(group.tags[0]!.values).toEqual({ mood: "tense" });
    expect(group.properties[0]!.stages).toEqual(["calm", "tense"]);
    expect(result.tags.has(box)).toBe(true);
  });
});

describe("stageGateCount", () => {
  it("counts the gates that order against a ladder, not those that ask for exactly one stage", () => {
    const source = fresh();
    const dialect = projectDialect(source);
    // Three `@act >= "act-1"` gates; `@act == "arrival"` asks for one stage and
    // means the same whatever the order.
    expect(stageGateCount(source, { kind: "property", scope: "story", name: "act" }, dialect)).toBe(3);
    expect(stageGateCount(source, { kind: "field", box: source.boxes[0]!.box.box.id, template: "fields", name: "x" }, dialect)).toBe(0);
  });
});
