// ---------------------------------------------------------------------------
// Property usage: "where is @x used?". Expectations hand-written from the
// worked example (the-hamlet), which is also what the Find window's Property
// tab shows: every read and every write, the write naming its outcome.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/load.js";
import { parsePropertyQuery, runPropertyUsage } from "../src/usage.js";

const exampleDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));
const loaded = loadProject(exampleDir);

const brief = (q: string) => runPropertyUsage(loaded, q).map((u) => `${u.use} ${u.item.kind} ${u.item.id} ${u.where}`);

describe("runPropertyUsage", () => {
  it("finds every read and every write of a story property, the write by its outcome", () => {
    const hits = runPropertyUsage(loaded, "@story.act");
    // Reads: the three cards gated on the act. A bare `@act` in the source
    // resolves to @story.act in the compiled bundle, which is why the scan reads
    // the bundle and not the text.
    expect(hits.filter((h) => h.use === "read").map((h) => h.item.id).sort())
      .toEqual(["c_arrive", "c_gareth_troubled", "c_mira_distracted"]);
    // Writes: three outcomes set it, and each hit is the OUTCOME (with its card).
    const writes = hits.filter((h) => h.use === "write");
    expect(writes.map((h) => h.item.id).sort()).toEqual(["c_arrive_o", "c_bryna_cautious", "c_bryna_pledge"]);
    expect(writes.every((h) => h.item.kind === "outcome" && h.item.card !== undefined)).toBe(true);
    const arrive = writes.find((h) => h.item.id === "c_arrive_o")!;
    expect(arrive.text).toBe('@story.act ← "act-1"');
    expect(arrive.where).toBe("outcome change");
    expect(arrive.item.location).toEqual(["Village", "Arrival", "Arrive at the Village Gate"]);
    // Every hit names the canonical property.
    expect(new Set(hits.map((h) => h.property))).toEqual(new Set(["@story.act"]));
  });

  it("lists in bundle order: a card's When before its outcomes' changes, deck by deck", () => {
    expect(brief("@story.act")).toEqual([
      "read card c_arrive When",
      "write outcome c_arrive_o outcome change",
      // Display order, not id order: the pledge is written above the cautious
      // reply in the deck, and outcomes now reach the bundle the way the author
      // arranged them.
      "write outcome c_bryna_pledge outcome change",
      "write outcome c_bryna_cautious outcome change",
      "read card c_gareth_troubled When",
      "read card c_mira_distracted When",
    ]);
  });

  it("finds a world property that is only ever read, with the condition as written", () => {
    const hits = runPropertyUsage(loaded, "@world.time_of_day");
    expect(hits.map((h) => [h.use, h.item.id, h.text])).toEqual([
      ["read", "c_amb_night", '@world.time_of_day == "night"'],
      ["read", "c_tree_night", '@village_open and @world.time_of_day == "night"'],
    ]);
  });

  it("matches a bare name in any scope and a scoped name only in its scope", () => {
    expect(brief("act")).toEqual(brief("@story.act"));
    expect(brief("@act")).toEqual(brief("@story.act"));
    expect(runPropertyUsage(loaded, "@world.act")).toEqual([]);
  });

  it("reads a property written by a self-referential change once, as the write", () => {
    // `@story.reputation ← @reputation + 1` both reads and writes reputation:
    // one row, the write, not a read beside it saying the same thing.
    const hits = runPropertyUsage(loaded, "@story.reputation").filter((h) => h.item.id === "c_inn_warm");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.use).toBe("write");
  });

  it("returns nothing for a query that is not a property reference", () => {
    expect(runPropertyUsage(loaded, "")).toEqual([]);
    expect(runPropertyUsage(loaded, "not a ref")).toEqual([]);
    expect(runPropertyUsage(loaded, "@nothing.here.at.all")).toEqual([]);
  });
});

describe("parsePropertyQuery", () => {
  it("reads the forms the Find window accepts", () => {
    expect(parsePropertyQuery("@gold")).toEqual({ name: "gold" });
    expect(parsePropertyQuery("gold")).toEqual({ name: "gold" });
    expect(parsePropertyQuery("@story.act")).toEqual({ scope: "story", name: "act" });
    expect(parsePropertyQuery("world.time_of_day")).toEqual({ scope: "world", name: "time_of_day" });
    expect(parsePropertyQuery("@box.village.heat")).toEqual({ scope: "box", container: "village", name: "heat" });
    expect(parsePropertyQuery("@hand.peril")).toEqual({ scope: "hand", name: "peril" });
  });
  it("rejects what is not a ref", () => {
    expect(parsePropertyQuery("")).toBeNull();
    expect(parsePropertyQuery("@story.act == 1")).toBeNull();
    expect(parsePropertyQuery("@faction.rebels.x")).toBeNull(); // not a scope
  });
});
