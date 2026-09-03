// ---------------------------------------------------------------------------
// runReplace: project-wide find-and-replace over item text. Expectations
// hand-written from the worked example: a word in two purposes is found and
// rewritten, and nothing that is not author text (conditions, gameIds, ids,
// changes) moves.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSource } from "@storylet-studio/compiler";
import type { DeckShard } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { runReplace } from "../src/replace.js";

const exampleDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));
const loaded = loadProject(exampleDir);

describe("runReplace", () => {
  it("plans a hit per text and a write per shard for a word in two purposes", () => {
    const plan = runReplace(loaded, { query: "hammer", replacement: "mallet" });
    expect(plan.hits.map((h) => [h.kind, h.id, h.field])).toEqual([
      ["card", "c_amb_forge", "purpose"],
      ["card", "c_gareth_troubled", "purpose"],
    ]);
    expect(plan.hits[0]).toMatchObject({
      location: ["Village", "Ambients"],
      before: "Gareth's hammer keeps time across the village, steady as a heartbeat.",
      after: "Gareth's mallet keeps time across the village, steady as a heartbeat.",
    });
    expect(plan.items).toBe(2);
    expect(plan.writes.map((w) => w.path.slice(exampleDir.length + 1)).sort())
      .toEqual(["village/decks/ambients.storyletdeck", "village/decks/gareths-debt.storyletdeck"]);
  });

  it("writes the shard canonically, with only the text changed", () => {
    const plan = runReplace(loaded, { query: "hammer", replacement: "mallet" });
    const write = plan.writes.find((w) => w.path.endsWith("ambients.storyletdeck"))!;
    const before = readFileSync(write.path, "utf8");
    const after = parseSource(write.content) as DeckShard;
    const was = parseSource(before) as DeckShard;
    // Conditions, gameIds and ids are byte-for-byte what they were.
    expect(after.cards.map((c) => [c.id, c.gameId, c.condition])).toEqual(was.cards.map((c) => [c.id, c.gameId, c.condition]));
    expect(after.cards.flatMap((c) => c.outcomes.map((o) => o.changes))).toEqual(was.cards.flatMap((c) => c.outcomes.map((o) => o.changes)));
    // The text moved, and nothing else did: the diff is the one line.
    const changedLines = write.content.split("\n").filter((l, i) => l !== before.split("\n")[i]);
    expect(changedLines).toEqual(['      purpose: "Gareth\'s mallet keeps time across the village, steady as a heartbeat.",']);
  });

  it("touches titles, purposes and string fields, not conditions or addresses", () => {
    // "village" is in titles, purposes and the box's gameId and a tag; only text moves.
    const plan = runReplace(loaded, { query: "village", replacement: "hamlet" });
    const fields = new Set(plan.hits.map((h) => h.field));
    expect([...fields].every((f) => f === "title" || f === "purpose" || f === "name" || f.startsWith("field:"))).toBe(true);
    // The project is named "The Hamlet" since the sample rename, so "village"
    // must NOT hit the project name any more - and must still hit the fiction.
    expect(plan.hits.some((h) => h.kind === "project" && h.field === "name")).toBe(false);
    expect(plan.hits.some((h) => h.kind === "box" && h.field === "title")).toBe(true);      // "Village"
    expect(plan.hits.some((h) => h.kind === "outcome")).toBe(true);                          // "Pledge your help to the village"
    for (const w of plan.writes) {
      expect(w.content).not.toContain("hamlet_open");   // the property @village_open in conditions
      expect(w.content).not.toContain('gameId: "hamlet"');
    }
    const box = plan.writes.find((w) => w.path.endsWith("box.storyletbox"))!;
    expect(box.content).toContain('gameId: "village"');
    expect(box.content).toContain('title: "hamlet"');   // the replacement is literal: no case carried over
  });

  it("replaces a card's string field, and leaves numbers and booleans alone", () => {
    // Taken FROM the project rather than written in: which card fields the
    // example declares, and what it puts in them, is content, and hard-coding
    // it made this test break for a reason that had nothing to do with Replace.
    // What is being pinned is that a card field is reachable and rewritable,
    // and that the hit names it `field:<name>`.
    const field = ((loaded.source!.boxes[0]!.box.box.fields ?? []) as { name: string }[])[0]!.name;
    const cards = loaded.source!.boxes[0]!.decks.flatMap((d) => d.shard.cards ?? []);
    // A value only ONE card carries, so exactly one card-field hit is expected.
    const counts = new Map<string, number>();
    for (const c of cards) {
      const v = c.fields?.[field];
      if (typeof v === "string" && v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const unique = [...counts].find(([, n]) => n === 1)?.[0];
    expect(unique, `a ${field} value carried by exactly one card`).toBeDefined();
    const deck = loaded.source!.boxes[0]!.decks
      .find((d) => (d.shard.cards ?? []).some((c) => c.fields?.[field] === unique))!;
    const owner = (deck.shard.cards ?? []).find((c) => c.fields?.[field] === unique)!;

    // The value may also occur in prose, which is not this test's business, so
    // narrow to the field hits: exactly one, on the owning card, rewritten.
    const plan = runReplace(loaded, { query: unique!, replacement: "zzz-replaced" });
    expect(plan.hits.filter((h) => h.field === `field:${field}`)).toEqual([{
      id: owner.id, kind: "card", field: `field:${field}`,
      location: [loaded.source!.boxes[0]!.box.box.title, deck.shard.deck.title],
      before: unique, after: "zzz-replaced",
    }]);
  });

  it("is case-insensitive by default, case-sensitive on request, whole-word on request", () => {
    expect(runReplace(loaded, { query: "HAMMER", replacement: "x" }).hits).toHaveLength(2);
    expect(runReplace(loaded, { query: "HAMMER", replacement: "x", caseSensitive: true }).hits).toHaveLength(0);
    expect(runReplace(loaded, { query: "hamme", replacement: "x" }).hits).toHaveLength(2);
    expect(runReplace(loaded, { query: "hamme", replacement: "x", wholeWord: true }).hits).toHaveLength(0);
  });

  it("treats the query and replacement as literal text", () => {
    expect(runReplace(loaded, { query: "ham.er", replacement: "x" }).hits).toHaveLength(0);
    const plan = runReplace(loaded, { query: "hammer", replacement: "$&!" });
    expect(plan.hits[0]!.after).toContain("$&!");
  });

  it("scopes to one item, and to one of its texts, for the per-row Replace", () => {
    expect(runReplace(loaded, { query: "hammer", replacement: "x", onlyId: "c_amb_forge" }).hits).toHaveLength(1);
    expect(runReplace(loaded, { query: "hammer", replacement: "x", onlyId: "c_nobody" }).hits).toHaveLength(0);
    const both = runReplace(loaded, { query: "gareth", replacement: "g", onlyId: "c_gareth_troubled" });
    // Only two now: this card's `music` cue is "unease", which has no "gareth" in it.
    expect(both.hits.map((h) => h.field).sort()).toEqual(["purpose", "title"]);
    const one = runReplace(loaded, { query: "gareth", replacement: "g", onlyId: "c_gareth_troubled", onlyField: "title" });
    expect(one.hits.map((h) => h.field)).toEqual(["title"]);
  });

  it("returns an empty plan for an empty query or no match", () => {
    expect(runReplace(loaded, { query: "", replacement: "x" }).writes).toHaveLength(0);
    expect(runReplace(loaded, { query: "nothinghere", replacement: "x" }).writes).toHaveLength(0);
  });

  it("applied to a copy, the project reloads with the new text and compiles unchanged elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "storylets-replace-"));
    cpSync(exampleDir, dir, { recursive: true });
    const copy = loadProject(dir);
    const plan = runReplace(copy, { query: "hammer", replacement: "mallet" });
    for (const w of plan.writes) writeFileSync(w.path, w.content);
    const again = loadProject(dir);
    expect(runReplace(again, { query: "hammer", replacement: "mallet" }).hits).toHaveLength(0);
    expect(runReplace(again, { query: "mallet", replacement: "hammer" }).hits).toHaveLength(2);
    expect(again.issues.filter((i) => i.severity === "error")).toEqual(loaded.issues.filter((i) => i.severity === "error"));
  });
});
