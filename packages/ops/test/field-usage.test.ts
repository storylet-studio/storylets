// ---------------------------------------------------------------------------
// Field usage: the Find window's Field tab. Expectations hand-written from the
// probe fixture: a harbour box whose card template declares `mood` (enum,
// default calm), set to tense on the bell and left alone on the tide, and the
// probe extension's fields on every kind of node.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/load.js";
import { declaredFields, runFieldUsage } from "../src/field-usage.js";

const probe = loadProject(fileURLToPath(new URL("./fixtures/probe-extension.storylets", import.meta.url)));
const hamlet = loadProject(fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url)));

const brief = (q: string) => runFieldUsage(probe, q).map((u) => `${u.item.kind} ${u.item.id} ${u.field}=${u.text}${u.isDefault ? " (default)" : ""}`);

describe("runFieldUsage", () => {
  it("lists every card the template declares a field for, with the value that holds", () => {
    expect(brief("mood")).toEqual(["card c_bell mood=tense", "card c_tide mood=calm (default)"]);
  });

  it("matches the value by the field's type, and the default counts", () => {
    expect(brief("mood = tense")).toEqual(["card c_bell mood=tense"]);
    expect(brief("Mood = CALM")).toEqual(["card c_tide mood=calm (default)"]);
    expect(brief("mood != tense")).toEqual(["card c_tide mood=calm (default)"]);
  });

  it("reads an extension's fields as extension.field, on the nodes it declares them for", () => {
    expect(brief("probe.note")).toEqual(["card c_bell probe.note=Ring it twice.", "card c_tide probe.note= (default)"]);
    expect(brief("probe.marks = night")).toEqual(["card c_bell probe.marks=night"]);
    expect(brief("probe.loud = true")).toEqual(["card c_bell probe.loud=true"]);
    expect(brief("probe.weight = 4")).toEqual(["card c_bell probe.weight=4"]);
    expect(brief("probe.weight = 1")).toEqual(["card c_tide probe.weight=1 (default)"]);
    expect(brief("probe.line = the bell rings.")).toEqual(["outcome o_ring probe.line=The bell rings."]);
    expect(brief("probe.theme")).toEqual(["box b_harbour probe.theme=salt"]);
    // Hands come in shard order; the watch sets north, the stall holds it by default.
    expect(brief("probe.seat = north")).toEqual(["hand h_stall probe.seat=north (default)", "hand h_watch probe.seat=north"]);
    expect(brief("probe.size").map((r) => r.split(" ")[0])).toEqual(["template"]);
  });

  it("leaves out editor-only fields and fields that are structure, not a value", () => {
    expect(runFieldUsage(probe, "probe.draft")).toEqual([]);
    expect(runFieldUsage(probe, "probe.cue")).toEqual([]);
    expect(runFieldUsage(probe, "probe.next")).toEqual([]);
  });

  it("names the item as Find does, with its trail", () => {
    const [bell] = runFieldUsage(probe, "mood = tense");
    expect(bell!.item.location).toEqual(["harbour", "rumours"]);
    expect(bell!.where).toBe("card field");
  });

  it("returns nothing for a field no one declares, or a query that is not a field", () => {
    expect(runFieldUsage(probe, "colour")).toEqual([]);
    expect(runFieldUsage(probe, "")).toEqual([]);
    expect(runFieldUsage(probe, "@gold")).toEqual([]);
    expect(runFieldUsage(hamlet, "mood")).toEqual([]);
    expect(runFieldUsage(hamlet, "music = jig")).toEqual([]);
  });
});

describe("declaredFields", () => {
  it("lists the template's fields first, then each extension's simple ones", () => {
    const fields = declaredFields(probe).map((f) => f.field);
    expect(fields[0]).toBe("mood");
    expect(fields).toContain("probe.note");
    expect(fields).toContain("probe.line");
    expect(fields).not.toContain("probe.draft");
    expect(fields).not.toContain("probe.cue");
    expect(declaredFields(hamlet)).toEqual([{ field: "music", type: "string", where: "card field" }]);
  });
});
