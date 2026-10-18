// ---------------------------------------------------------------------------
// Storylet extensions end to end, on the internal test extension "probe"
// (fixtures/probe-extension.storylets; never published, never in a kit or the
// public docs, ruled 2026-10-18): a project that takes it, a shard of its data
// per box and one for the project, carried, merged, validated, compiled and
// formatted. The shared spec's own cases are in @wildwinter/toolkit/extensions; these
// are the Storylets format's half (patterkit design/proposals/
// patter-storylet-extensions.md, phase 3).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, compileProject, parseSource, projectHash } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import { unresolvedOf, withoutMark } from "@wildwinter/toolkit/extensions";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";
import { runFormat } from "../src/format.js";
import { planShardMerge, runMerge } from "../src/merge.js";
import { planExtensionValue, projectManifests, readProjectManifest } from "../src/extensions.js";
import { runPack } from "../src/pack.js";
import { runExport } from "../src/export.js";

const fixture = fileURLToPath(new URL("./fixtures/probe-extension.storylets", import.meta.url));

/** A throwaway copy of the fixture, to change. */
function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "probe-")), "probe.storylets");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): Record<string, unknown> => parseSource(readFileSync(join(dir, rel), "utf8")) as Record<string, unknown>;
const write = (dir: string, rel: string, value: unknown): void => writeFileSync(join(dir, rel), canonicalStringify(value));
const BOX_SHARD = "harbour/probe.storyletextension";

/** The box shard's entries, to edit. */
type Entries = Record<string, Record<string, Record<string, unknown>>>;
const editBox = (dir: string, edit: (entries: Entries) => void): void => {
  const shard = read(dir, BOX_SHARD);
  edit(shard["entries"] as Entries);
  write(dir, BOX_SHARD, shard);
};

const messages = (issues: readonly Issue[], severity?: "error" | "warning"): string[] =>
  issues.filter((i) => severity === undefined || i.severity === severity).map((i) => `${i.path}: ${i.message}`);

function compiled(dir: string): { bundle?: Bundle; issues: Issue[] } {
  const loaded = loadProject(dir);
  expect(loaded.source, messages(loaded.issues).join("\n")).toBeDefined();
  return compileProject(loaded.source!);
}

describe("the probe project", () => {
  it("loads its manifest and its data shards, and validates with one warning: a stage the extension renamed", () => {
    const loaded = loadProject(fixture);
    expect(loaded.source?.manifests?.map((m) => m.path)).toEqual(["extensions/probe.extension.json"]);
    expect(loaded.source?.extensions?.map((e) => e.path)).toEqual(["probe.storyletextension"]);
    expect(loaded.source?.boxes[0]?.extensions?.map((e) => e.path)).toEqual([BOX_SHARD]);
    const result = runValidate(loaded, { checkBundle: false });
    expect(messages(result.issues, "error")).toEqual([]);
    expect(messages(result.issues, "warning")).toEqual([
      `${BOX_SHARD}: entries.card.c_bell.act: "act" is "opening", a stage this extension has since renamed "setup"`,
    ]);
  });

  it("compiles each node's values inline, renamed, editor-only fields stripped, declarations resolved", () => {
    const { bundle, issues } = compiled(fixture);
    expect(messages(issues, "error")).toEqual([]);
    const box = bundle!.boxes[0]!;
    const card = box.decks[0]!.cards.find((c) => c.id === "c_bell")!;
    expect(card.extensions).toEqual({ probe: {
      act: "setup", beats: [{ at: 3, id: "b2" }, { at: 1, id: "b1" }], cue: { gain: 0.5, sound: "bell" }, loud: true,
      marks: ["night"], next: "c_tide", note: "Ring it twice.", perf: { v_docks: "frown" }, tone: "tense", weight: 4,
      words: ["salt", "rope"],
    } });
    // `draft` is editor-only: in the shard, never in the bundle.
    expect(JSON.stringify(bundle)).not.toContain("Maybe three times");
    expect(box.decks[0]!.cards.find((c) => c.id === "c_tide")!.extensions).toBeUndefined();
    expect(card.outcomes.find((o) => o.id === "o_ring")!.extensions).toEqual({ probe: { line: "The bell rings." } });
    expect(box.extensions).toEqual({ probe: { theme: "salt" } });
    expect(box.tagGroups[0]!.extensions).toEqual({ probe: { shown: true } });
    expect(box.tagGroups[0]!.tags.find((t) => t.id === "v_docks")!.extensions).toEqual({ probe: { colour: "tar" } });
    expect(box.decks[0]!.extensions).toEqual({ probe: { pile: 2 } });
    expect(box.handTemplates[0]!.extensions).toEqual({ probe: { size: 3 } });
    expect(box.hands.find((h) => h.id === "h_watch")!.extensions).toEqual({ probe: { seat: "north" } });

    const section = bundle!.extensions!["probe"]!;
    expect(section.version).toBe("1.1.0");
    expect(section.project).toEqual({ studio: "Wildwinter" });
    expect(Object.keys(section.fields).sort()).toEqual(["box", "card", "deck", "hand", "handTemplate", "outcome", "project", "tag", "tagGroup"]);
    const cardDecls = section.fields["card"]!;
    expect(cardDecls.map((d) => d.name)).not.toContain("draft");
    expect(cardDecls.every((d) => d.default !== undefined)).toBe(true);
    expect(cardDecls.find((d) => d.name === "cue")!.default).toEqual({ gain: 0, sound: "" });
    expect(cardDecls.find((d) => d.name === "act")!.default).toBe("setup");
    // The editor's words never ship.
    expect(JSON.stringify(section)).not.toMatch(/"(help|label|valueHelp|renamedStages|editorOnly)"/);
  });

  it("puts compiled extension data in the content hash, and leaves editor-only data out of it", () => {
    const dir = scratch();
    try {
      const before = projectHash(loadProject(dir).source!);
      editBox(dir, (e) => { e["card"]!["c_bell"]!["draft"] = "A different working note."; });
      expect(projectHash(loadProject(dir).source!)).toBe(before);
      editBox(dir, (e) => { e["card"]!["c_bell"]!["note"] = "Ring it once."; });
      expect(projectHash(loadProject(dir).source!)).not.toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("leaves a project that takes no extension hashing as it always has", () => {
    const dir = scratch();
    try {
      const project = read(dir, "probe.storyletproj");
      delete project["extensions"];
      write(dir, "probe.storyletproj", project);
      rmSync(join(dir, "extensions"), { recursive: true });
      rmSync(join(dir, "probe.storyletextension"));
      rmSync(join(dir, BOX_SHARD));
      const { bundle } = compiled(dir);
      expect(bundle!.extensions).toBeUndefined();
      expect(JSON.stringify(bundle)).not.toContain("extensions");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("validation, driven by the manifest", () => {
  const issuesAfter = (edit: (dir: string) => void): Issue[] => {
    const dir = scratch();
    try {
      edit(dir);
      return runValidate(loadProject(dir), { checkBundle: false }).issues;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it("checks each value against its type, and stops the bundle on an error", () => {
    const issues = issuesAfter((dir) => editBox(dir, (e) => {
      e["card"]!["c_bell"]!["weight"] = 11;
      e["card"]!["c_bell"]!["cue"] = { gain: 0.2 };
      e["card"]!["c_bell"]!["perf"] = { v_gone: "smile" };
      e["card"]!["c_bell"]!["beats"] = [{ id: "b1", at: 1 }, { id: "b1", at: 2 }];
      e["card"]!["c_bell"]!["tune"] = "calm";
    }));
    expect(messages(issues, "error")).toEqual([
      `${BOX_SHARD}: entries.card.c_bell.beats[1].id: "beats[1]" repeats the id "b1"`,
      `${BOX_SHARD}: entries.card.c_bell.cue.sound: "cue.sound" is required and not set`,
      `${BOX_SHARD}: entries.card.c_bell.perf.v_gone: "perf.v_gone" is keyed by tag "v_gone", which does not exist`,
      `${BOX_SHARD}: entries.card.c_bell.weight: "weight" is 11, above the most it may be, 10`,
    ]);
    expect(messages(issues, "warning")).toContain(
      `${BOX_SHARD}: entries.card.c_bell.tune: "tune" is not a field this extension declares; it is kept, and not compiled`);
  });

  it("reports an entry for a node that has gone, per entry, as a warning, and keeps it", () => {
    const issues = issuesAfter((dir) => editBox(dir, (e) => { e["card"]!["c_gone"] = { note: "x" }; }));
    expect(messages(issues, "error")).toEqual([]);
    expect(messages(issues, "warning")).toContain(
      `${BOX_SHARD}: entries.card.c_gone: an entry for card "c_gone", which no longer exists; it is kept, and not compiled`);
  });

  it("reports orphans in view and map shards too, per entry", () => {
    const issues = issuesAfter((dir) => {
      write(dir, "harbour/view.storyletview", { schema: "storylets/view@0", canvases: {
        k_rumours: { cards: { c_bell: { x: 1, y: 2 }, c_gone: { x: 3, y: 4 } } }, k_gone: { cards: {} } } });
      write(dir, "harbour/map.storyletmap", { schema: "storylets/map@0", map: { sites: { h_watch: { x: 1, y: 1 }, h_gone: { x: 2, y: 2 } } } });
    });
    expect(messages(issues, "warning")).toEqual(expect.arrayContaining([
      "harbour/view.storyletview: a point on deck k_rumours's canvas for card c_gone, which is not in that deck any more; it is kept, and shown nowhere",
      "harbour/view.storyletview: a canvas for deck k_gone, which is not in this box any more; it is kept, and shown nowhere",
      "harbour/map.storyletmap: a site for hand h_gone, which is not in this box any more; it is kept, and shown nowhere",
    ]));
  });

  it("opens a project whose manifest is missing with a warning, and leaves its data uncompiled and untouched", () => {
    const dir = scratch();
    try {
      rmSync(join(dir, "extensions"), { recursive: true });
      const before = readFileSync(join(dir, BOX_SHARD), "utf8");
      const result = runValidate(loadProject(dir), { checkBundle: false });
      expect(messages(result.issues, "error")).toEqual([]);
      expect(messages(result.issues, "warning")).toContain(
        "probe.storyletproj: the project takes the Storylet extension \"probe\", but has no manifest for it at extensions/probe.extension.json; its data is left as it is, and not compiled");
      const { bundle } = compiled(dir);
      expect(bundle!.extensions).toBeUndefined();
      expect(JSON.stringify(bundle)).not.toContain("Ring it twice");
      expect(readFileSync(join(dir, BOX_SHARD), "utf8")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("warns about data for an extension the project does not take", () => {
    const issues = issuesAfter((dir) => {
      const project = read(dir, "probe.storyletproj");
      delete project["extensions"];
      write(dir, "probe.storyletproj", project);
    });
    expect(messages(issues, "warning")).toContain(
      `${BOX_SHARD}: data for the Storylet extension "probe", which the project does not take; it is left as it is, and not compiled`);
  });

  it("refuses a manifest that breaks the spec, by path", () => {
    const issues = issuesAfter((dir) => {
      const m = JSON.parse(readFileSync(join(dir, "extensions/probe.extension.json"), "utf8"));
      m.targets.storylets.card.fields[2].min = 20;
      writeFileSync(join(dir, "extensions/probe.extension.json"), JSON.stringify(m, null, 2));
    });
    expect(messages(issues, "error")).toContain(
      "extensions/probe.extension.json: manifest targets.storylets.card.fields[2].max: the range runs from 20 down to 10");
  });

  it("errors on a claimed field a box declares with another type, naming the box", () => {
    const issues = issuesAfter((dir) => {
      const box = read(dir, "harbour/box.storyletbox") as { box: { fields: { name: string; type: string; default?: unknown; values?: string[] }[] } };
      box.box.fields = [{ name: "mood", type: "text", default: "" }];
      write(dir, "harbour/box.storyletbox", box);
      const deck = read(dir, "harbour/decks/rumours.storyletdeck") as { cards: { fields?: Record<string, unknown> }[] };
      deck.cards[0]!.fields = { mood: "tense" };
      write(dir, "harbour/decks/rumours.storyletdeck", deck);
    });
    expect(messages(issues, "error")).toContain(
      "harbour/box.storyletbox: the Storylet extension \"probe\" claims the card field \"mood\" as enum, but box \"harbour\" declares it as text");
  });

  it("checks a claimed field's values against the claim, and follows the project's setting for its name", () => {
    const issues = issuesAfter((dir) => {
      const box = read(dir, "harbour/box.storyletbox") as { box: { fields: unknown[] } };
      box.box.fields = [{ name: "temper", type: "enum", values: ["calm", "tense", "wild"], default: "calm" }];
      write(dir, "harbour/box.storyletbox", box);
      const deck = read(dir, "harbour/decks/rumours.storyletdeck") as { cards: { fields?: Record<string, unknown> }[] };
      deck.cards[0]!.fields = { temper: "wild" };
      write(dir, "harbour/decks/rumours.storyletdeck", deck);
      const project = read(dir, "probe.storyletproj") as { extensions: { probe: { settings: Record<string, string> } } };
      project.extensions.probe.settings["moodField"] = "temper";
      write(dir, "probe.storyletproj", project);
    });
    expect(messages(issues, "error")).toContain(
      "harbour/decks/rumours.storyletdeck: field \"temper\", as the Storylet extension \"probe\" claims it: the value is \"wild\", which is not one of its values");
  });

  it("warns about a claim on a field no box declares", () => {
    const issues = issuesAfter((dir) => {
      const project = read(dir, "probe.storyletproj") as { extensions: { probe: { settings: Record<string, string> } } };
      project.extensions.probe.settings["moodField"] = "temper";
      write(dir, "probe.storyletproj", project);
    });
    expect(messages(issues, "error")).toEqual([]);
    expect(messages(issues, "warning")).toContain(
      "probe.storyletproj: the Storylet extension \"probe\" claims the card field \"temper\", which no box declares; set the extension's \"moodField\" setting to the field's name, or declare it");
  });

  it("errors when two extensions claim one field, naming both", () => {
    const issues = issuesAfter((dir) => {
      const m = JSON.parse(readFileSync(join(dir, "extensions/probe.extension.json"), "utf8"));
      m.id = "rival";
      writeFileSync(join(dir, "extensions/rival.extension.json"), JSON.stringify(m, null, 2));
      const project = read(dir, "probe.storyletproj") as { extensions: Record<string, unknown> };
      project.extensions["rival"] = { version: "1.1.0" };
      write(dir, "probe.storyletproj", project);
    });
    expect(messages(issues, "error")).toEqual(["probe.storyletproj: extensions \"probe\" and \"rival\" both claim the card field \"mood\""]);
  });
});

describe("merge, by the project's manifest", () => {
  const shardText = (dir: string): string => readFileSync(join(dir, BOX_SHARD), "utf8");
  const edited = (base: string, edit: (entries: Entries) => void): string => {
    const shard = parseSource(base) as { entries: Entries };
    edit(shard.entries);
    return canonicalStringify(shard);
  };

  it("merges two people's edits to one card's record field by field, and to different characters' looks", () => {
    const base = shardText(fixture);
    const ours = edited(base, (e) => { (e["card"]!["c_bell"]!["cue"] as Record<string, unknown>)["sound"] = "gong"; });
    const theirs = edited(base, (e) => {
      (e["card"]!["c_bell"]!["cue"] as Record<string, unknown>)["gain"] = 0.9;
      (e["card"]!["c_bell"]!["perf"] as Record<string, unknown>)["v_market"] = "smile";
    });
    const step = planShardMerge({ rel: BOX_SHARD, path: join(fixture, BOX_SHARD), base, ours, theirs, manifest: projectManifests(fixture) });
    expect(step.result!.conflicts).toEqual([]);
    const card = (parseSource(step.write!.content) as { entries: Entries }).entries["card"]!["c_bell"]!;
    expect(card["cue"]).toEqual({ gain: 0.9, sound: "gong" });
    expect(card["perf"]).toEqual({ v_docks: "frown", v_market: "smile" });
  });

  it("without the manifest merges each node's entry whole, so the same edits clash, marked in the shard", () => {
    const base = shardText(fixture);
    const ours = edited(base, (e) => { (e["card"]!["c_bell"]!["cue"] as Record<string, unknown>)["sound"] = "gong"; });
    const theirs = edited(base, (e) => { (e["card"]!["c_bell"]!["cue"] as Record<string, unknown>)["gain"] = 0.9; });
    const step = planShardMerge({ rel: BOX_SHARD, path: join(fixture, BOX_SHARD), base, ours, theirs });
    expect(step.result!.conflicts.map((c) => c.path)).toEqual(["entries.card.c_bell"]);
    const merged = parseSource(step.write!.content);
    expect(unresolvedOf(merged)?.map((u) => u.path)).toEqual(["entries.card.c_bell"]);
    expect(step.sidecar).toBeDefined();
  });

  it("a shard carrying the mark is refused by validate, export and pack, and passes once the mark is gone", async () => {
    const dir = scratch();
    try {
      const base = shardText(dir);
      const ours = edited(base, (e) => { e["card"]!["c_bell"]!["note"] = "Ours."; });
      const theirs = edited(base, (e) => { e["card"]!["c_bell"]!["note"] = "Theirs."; });
      const result = runMerge(parseSource(base) as Record<string, unknown>, parseSource(ours) as Record<string, unknown>,
        parseSource(theirs) as Record<string, unknown>, { manifest: readProjectManifest(dir, "probe")! });
      writeFileSync(join(dir, BOX_SHARD), canonicalStringify(result.merged));
      const issues = runValidate(loadProject(dir), { checkBundle: false }).issues;
      expect(messages(issues, "error")).toEqual([
        `${BOX_SHARD}: unresolved merge at entries.card.c_bell.note: the shard holds our side of a clash; resolve it, then remove the entry from "unresolved"`,
      ]);
      expect(messages(runExport(loadProject(dir)).issues, "error")).toHaveLength(1);
      await expect(runPack(dir)).rejects.toThrow(/unresolved merge/);
      // Resolving is taking a side and removing the mark.
      writeFileSync(join(dir, BOX_SHARD), canonicalStringify(withoutMark(result.merged)));
      expect(messages(runValidate(loadProject(dir), { checkBundle: false }).issues, "error")).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("marks any shard type, not only extension shards", () => {
    const deck = read(fixture, "harbour/decks/rumours.storyletdeck") as { cards: { id: string; priority: number }[] };
    const with_ = (priority: number) => ({ ...deck, cards: deck.cards.map((c) => (c.id === "c_bell" ? { ...c, priority } : c)) });
    const result = runMerge(deck as unknown as Record<string, unknown>, with_(5) as unknown as Record<string, unknown>, with_(9) as unknown as Record<string, unknown>);
    expect(unresolvedOf(result.merged)).toEqual([
      { path: "cards[c_bell].priority", kind: "both-changed", base: 2, ours: 5, theirs: 9 },
    ]);
  });

  it("the merge without a manifest is safe when the manifest is itself mid-conflict", () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, "extensions/probe.extension.json"), "<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n");
      expect(readProjectManifest(dir, "probe")).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("format and the canonical form", () => {
  it("never reorders the extension's own lists, whatever they are called", () => {
    const shard = { schema: "storylets/extension@0", extension: "probe", entries: { card: { c_1: {
      cards: [{ id: "z" }, { id: "a" }], tags: [{ id: "q" }, { id: "b" }] } } } };
    const text = canonicalStringify(shard);
    expect((parseSource(text) as typeof shard).entries.card.c_1.cards.map((c) => c.id)).toEqual(["z", "a"]);
    expect(text).not.toContain("order");
  });

  it("leaves the manifest alone, and takes a new extension version: renamed stages renamed and the pin moved, in one step", () => {
    const dir = scratch();
    try {
      const project = read(dir, "probe.storyletproj") as { extensions: { probe: { version: string } } };
      project.extensions.probe.version = "1.0.0";
      write(dir, "probe.storyletproj", project);
      const manifestBefore = readFileSync(join(dir, "extensions/probe.extension.json"), "utf8");
      const result = runFormat(loadProject(dir));
      expect(result.migrated).toEqual([
        "took the Storylet extension \"probe\" at version 1.1.0 (was 1.0.0)",
        `  renamed 1 stage value in ${BOX_SHARD}`,
      ]);
      for (const w of result.changed) writeFileSync(w.path, w.content);
      expect(result.changed.map((w) => w.path)).not.toContain(join(dir, "extensions/probe.extension.json"));
      expect(readFileSync(join(dir, "extensions/probe.extension.json"), "utf8")).toBe(manifestBefore);
      expect((read(dir, "probe.storyletproj") as typeof project).extensions.probe.version).toBe("1.1.0");
      expect((read(dir, BOX_SHARD)["entries"] as Entries)["card"]!["c_bell"]!["act"]).toBe("setup");
      const after = runValidate(loadProject(dir), { checkBundle: false });
      expect(messages(after.issues)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("packs", () => {
  it("carry the manifest and every extension shard", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await runPack(fixture));
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining([
      "extensions/probe.extension.json", "probe.storyletextension", BOX_SHARD,
    ]));
  });
});

describe("setting one value", () => {
  it("writes a card's value into its box's shard, keeps every other entry, and clears back to nothing", () => {
    const loaded = loadProject(fixture);
    const set = planExtensionValue(fixture, loaded.source!, "probe", "c_tide", "note", "High water.")!;
    expect(set.path).toBe(join(fixture, BOX_SHARD));
    const after = parseSource(set.content!) as { entries: Entries };
    expect(after.entries["card"]!["c_tide"]).toEqual({ note: "High water." });
    expect(after.entries["card"]!["c_bell"]!["note"]).toBe("Ring it twice.");
    const cleared = planExtensionValue(fixture, loaded.source!, "probe", "c_bell", "note", undefined)!;
    expect((parseSource(cleared.content!) as { entries: Entries }).entries["card"]!["c_bell"]!["note"]).toBeUndefined();
  });

  it("writes the project's own values at the root, creates a box's shard when it has none, and deletes one left empty", () => {
    const dir = scratch();
    try {
      rmSync(join(dir, BOX_SHARD));
      const source = loadProject(dir).source!;
      expect(planExtensionValue(dir, source, "probe", "proj_probe", "studio", "WW")!.path).toBe(join(dir, "probe.storyletextension"));
      const made = planExtensionValue(dir, source, "probe", "b_harbour", "theme", "salt")!;
      expect(made.path).toBe(join(dir, BOX_SHARD));
      expect(parseSource(made.content!)).toEqual({ schema: "storylets/extension@0", extension: "probe", entries: { box: { b_harbour: { theme: "salt" } } } });
      writeFileSync(made.path, made.content!);
      expect(planExtensionValue(dir, loadProject(dir).source!, "probe", "b_harbour", "theme", undefined)!.content).toBeNull();
      expect(planExtensionValue(dir, source, "probe", "c_gone", "note", "x")).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
