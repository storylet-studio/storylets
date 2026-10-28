// The clash resolver's main half (step 6, ruling Q21), over a REAL merge: each
// shard here is merged by ops' `planShardMerge`, exactly as a returned pack or a
// pull is, and written with its `.storyletconflict` sidecar. Then the clashes
// are listed from the marks, worded for a person, and each decision is one
// undoable step that takes the sidecar with the shard's last clash.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { CONFLICT_SIDECAR_EXTENSION, planShardMerge } from "@storylet-studio/ops";
import { openProject } from "./project.js";
import { redo, undo } from "./mutate/write-path.js";
import { describe as whereOf, display, listClashes, markClashResolved, resolveClash } from "./clashes.js";
import type { ProjectSession } from "./project.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));
const DECK = "encounters/decks/docks.storyletdeck";
const PROJECT = "saltmarsh.storyletproj";

type Obj = Record<string, unknown>;

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-clashes-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  return dir;
}

/** Merge a shard three ways on disk, as a pack merge does: base is what's there, ours and theirs edits of it. */
function mergeOnDisk(dir: string, rel: string, ours: (s: Obj) => void, theirs: (s: Obj) => void): void {
  const path = join(dir, rel);
  const base = readFileSync(path, "utf8");
  const edit = (f: (s: Obj) => void): string => { const s = parseSource(base) as Obj; f(s); return canonicalStringify(s); };
  const mine = edit(ours);
  writeFileSync(path, mine, "utf8");
  const step = planShardMerge({ rel, path, ours: mine, theirs: edit(theirs), base });
  if (step.write) writeFileSync(step.write.path, step.write.content, "utf8");
  if (step.sidecar) writeFileSync(step.sidecar.path, step.sidecar.content, "utf8");
}

function open(dir: string): ProjectSession {
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const cardOf = (s: Obj, id: string): Obj => (s["cards"] as Obj[]).find((c) => c["id"] === id)!;
const shardAt = (dir: string, rel: string): Obj => parseSource(readFileSync(join(dir, rel), "utf8")) as Obj;

/** Two clashes in the docks deck (a card's priority, an outcome's change) and one in the project (@story's default). */
function clashed(): ProjectSession {
  const dir = copy();
  mergeOnDisk(dir, DECK, (s) => {
    cardOf(s, "c_ambush")["priority"] = 5;
    ((cardOf(s, "c_ambush")["outcomes"] as Obj[])[1]!["changes"] as Obj)["@story.reputation"] = "@story.reputation - 2";
  }, (s) => {
    cardOf(s, "c_ambush")["priority"] = 9;
    ((cardOf(s, "c_ambush")["outcomes"] as Obj[])[1]!["changes"] as Obj)["@story.reputation"] = "@story.reputation - 3";
  });
  mergeOnDisk(dir, PROJECT, (s) => { (((s["story"] as Obj)["properties"] as Obj[])[0]!)["default"] = 1; },
    (s) => { (((s["story"] as Obj)["properties"] as Obj[])[0]!)["default"] = 2; });
  return open(dir);
}

describe("listing the clashes a merge left", () => {
  it("reads every shard's mark, worded for a person, with where Edit goes", () => {
    const session = clashed();
    const box = session.dto.boxes[0]!.id;
    const list = listClashes(session.loaded);
    expect(list.map((c) => c.where)).toEqual([
      "Outcome 'Flee' of card 'Ambush at the ford' in Docks deck: change to @story.reputation",
      "Card 'Ambush at the ford' in Docks deck: priority",
      "@story.reputation's default",
    ]);
    const priority = list.find((c) => c.path.endsWith("cards[c_ambush].priority"))!;
    expect(priority).toMatchObject({
      id: `${DECK}#cards[c_ambush].priority`, kind: "both-changed", ours: "5", theirs: "9", base: "2", settable: true,
      goto: { kind: "card", box, deck: "k_docks", card: "c_ambush" },
    });
    const change = list.find((c) => c.path.endsWith(".changes.@story.reputation"))!;
    expect(change).toMatchObject({ settable: true, goto: { kind: "outcome", outcome: "o_flee" } });
    const story = list.find((c) => c.id.startsWith(PROJECT))!;
    expect(story).toMatchObject({ where: "@story.reputation's default", ours: "1", theirs: "2", goto: { kind: "project" } });
  });

  it("is empty for a project no merge has touched", () => {
    expect(listClashes(open(copy()).loaded)).toEqual([]);
  });

  it("counts them on every result, for the banner", async () => {
    const session = clashed();
    const { openResult } = await import("./project.js");
    expect(openResult(session, []).clashes).toBe(3);
  });
});

describe("deciding a clash", () => {
  it("Take theirs sets the value, as one undoable step, and keeps the sidecar while the shard has clashes left", async () => {
    const session = clashed();
    const dir = session.loaded.dir;
    const id = `${DECK}#cards[c_ambush].priority`;
    const answer = await resolveClash(session, id, "theirs");
    if ("error" in answer) throw new Error(answer.error);
    expect(cardOf(shardAt(dir, DECK), "c_ambush")["priority"]).toBe(9);
    expect(answer.clashes.map((c) => c.id)).not.toContain(id);
    expect(answer.clashes).toHaveLength(2);
    expect(answer.result.clashes).toBe(2);
    expect(existsSync(join(dir, DECK + CONFLICT_SIDECAR_EXTENSION))).toBe(true);
    expect(session.history.undoLabel).toBe("Take their side of a clash");

    await undo(session);
    expect(cardOf(shardAt(dir, DECK), "c_ambush")["priority"]).toBe(5);
    expect(listClashes(session.loaded).map((c) => c.id)).toContain(id);
  });

  it("the shard's last clash takes the sidecar with it, and Undo brings both back", async () => {
    const session = clashed();
    const dir = session.loaded.dir;
    const sidecar = join(dir, DECK + CONFLICT_SIDECAR_EXTENSION);
    await resolveClash(session, `${DECK}#cards[c_ambush].priority`, "ours");
    const last = listClashes(session.loaded).find((c) => c.id.startsWith(DECK))!;
    const answer = await resolveClash(session, last.id, "theirs");
    if ("error" in answer) throw new Error(answer.error);
    expect(shardAt(dir, DECK)["unresolved"]).toBeUndefined();
    expect(cardOf(shardAt(dir, DECK), "c_ambush")["priority"]).toBe(5);
    expect(existsSync(sidecar)).toBe(false);
    expect(answer.clashes.map((c) => c.id)).toEqual([`${PROJECT}#story.properties[reputation].default`]);
    // Validation no longer refuses the deck: no mark, no sidecar.
    const unresolved = answer.result.problems.filter((p) => /unresolved merge/.test(p.message));
    expect(unresolved.some((p) => p.path.includes("docks"))).toBe(false);
    expect(unresolved.some((p) => p.path.includes(PROJECT))).toBe(true);

    await undo(session);
    expect(existsSync(sidecar)).toBe(true);
    expect(shardAt(dir, DECK)["unresolved"]).toHaveLength(1);
    await redo(session);
    expect(existsSync(sidecar)).toBe(false);
  });

  it("Mark resolved keeps a hand edit made since the merge", async () => {
    const session = clashed();
    const dir = session.loaded.dir;
    const s = shardAt(dir, PROJECT);
    (((s["story"] as Obj)["properties"] as Obj[])[0]!)["default"] = 7;
    writeFileSync(join(dir, PROJECT), canonicalStringify(s), "utf8");
    const fresh = open(dir);
    const answer = await markClashResolved(fresh, `${PROJECT}#story.properties[reputation].default`);
    if ("error" in answer) throw new Error(answer.error);
    const story = shardAt(dir, PROJECT);
    expect((((story["story"] as Obj)["properties"] as Obj[])[0]!)["default"]).toBe(7);
    expect(story["unresolved"]).toBeUndefined();
    expect(existsSync(join(dir, PROJECT + CONFLICT_SIDECAR_EXTENSION))).toBe(false);
    expect(fresh.history.undoLabel).toBe("Mark a clash resolved");
  });

  it("refuses an id the project doesn't hold", async () => {
    const session = clashed();
    expect(await resolveClash(session, `${DECK}#cards[c_nope].priority`, "ours")).toEqual({ error: expect.stringContaining("no unresolved clash") });
    expect(await resolveClash(session, "nowhere#x", "ours")).toEqual({ error: expect.any(String) });
  });
});

describe("the words", () => {
  it("names a card one side deleted from the side that kept it", () => {
    const shard = { schema: "storylets/deck@0", deck: { id: "k_1", title: "Opening" }, cards: [] };
    expect(whereOf(undefined, "x/decks/o.storyletdeck", shard, { path: "cards[c_1]", theirs: { id: "c_1", title: "Tavern Brawl" } }).where)
      .toBe("Card 'Tavern Brawl' in Opening deck");
  });

  it("shows a side as text", () => {
    expect(display(3)).toBe("3");
    expect(display("")).toBe("(empty)");
    expect(display(["a", "b"])).toBe("a, b");
    expect(display({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
