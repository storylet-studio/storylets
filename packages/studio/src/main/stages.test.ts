// A quality's stage renamed through Storyletter (mutate/stages.ts): the
// declaration and every literal naming the stage land as ONE undo step, and a
// value whose stage was deleted is put back on the ladder by the quick fix.
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "./project.js";
import type { ProjectSession } from "./project.js";
import { renameQualityStage, stageGates } from "./mutate/stages.js";
import { pickStage, pickTagStage } from "./mutate/quick-fixes.js";
import { commit, freshKey, undo } from "./mutate/write-path.js";
import { projectWrite } from "./mutate/shards.js";

const hamletDir = fileURLToPath(new URL("../../../ops/test/fixtures/the-hamlet.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-stages-")), "copy.storylets");
  cpSync(hamletDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}
const act = { kind: "property" as const, scope: "story" as const, name: "act" };
const arrivalDeck = (s: ProjectSession): string => readFileSync(join(s.loaded.dir, "village", "decks", "arrival.storyletdeck"), "utf8");
const projectShard = (s: ProjectSession): string => readFileSync(join(s.loaded.dir, "the-hamlet.storyletproj"), "utf8");

describe("renameQualityStage", () => {
  it("writes the declaration and every gate in one edit, and one undo puts all of it back", async () => {
    const session = scratch();
    const deckBefore = arrivalDeck(session);
    const projectBefore = projectShard(session);
    const result = await renameQualityStage(session, act, "act-1", "first-act");
    expect("error" in result).toBe(false);
    expect(projectShard(session)).toContain('"first-act"');
    expect(arrivalDeck(session)).toContain('@act >= \\"first-act\\"');
    expect(arrivalDeck(session)).not.toContain('\\"act-1\\"');
    await undo(session);
    expect(arrivalDeck(session)).toBe(deckBefore);
    expect(projectShard(session)).toBe(projectBefore);
  });

  it("leaves no empty Undo behind when the list saves straight after with nothing new", async () => {
    const session = scratch();
    const projectBefore = projectShard(session);
    await renameQualityStage(session, act, "act-1", "first-act");
    // The Story page's own save, queued behind the rename, writes the same bytes.
    await commit(session, "Story", freshKey(), [projectWrite(session)]);
    await undo(session);
    expect(projectShard(session)).toBe(projectBefore);
  });

  it("does nothing, without an error, when there is nothing to carry", async () => {
    const session = scratch();
    const before = arrivalDeck(session);
    const result = await renameQualityStage(session, act, "finale", "end");
    expect("error" in result).toBe(false);
    expect(arrivalDeck(session)).toBe(before);
  });

  it("counts the gates a reorder changes the meaning of", () => {
    expect(stageGates(scratch(), act)).toBe(3);
  });
});

describe("pickStage", () => {
  it("puts a field value back on its ladder, and refuses one that has already moved", async () => {
    const session = scratch();
    const box = session.loaded.source!.boxes[0]!;
    const deck = box.decks[0]!;
    const card = deck.shard.cards[0]!;
    card.fields = { ...card.fields, beat: "gone" };
    const done = await pickStage(session, deck.shard.deck.id, card.id, undefined, "beat", "gone", "open");
    expect("error" in done).toBe(false);
    expect(session.loaded.source!.boxes[0]!.decks[0]!.shard.cards[0]!.fields?.["beat"]).toBe("open");
    const again = await pickStage(session, deck.shard.deck.id, card.id, undefined, "beat", "gone", "open");
    expect(again).toEqual({ error: "that value has already changed" });
  });
});

describe("pickTagStage", () => {
  it("puts a tag's starting value back on its ladder, writes the tags shard, and refuses one that has already moved", async () => {
    const session = scratch();
    const box = session.loaded.source!.boxes[0]!;
    const tag = { id: "t_x", gameId: "tx", values: { standing: "gone" } as Record<string, string> };
    const group = { id: "g_x", gameId: "gx", properties: [], tags: [tag] };
    box.tags.groups.push(group as never);
    const done = await pickTagStage(session, group.id, tag.id, "standing", "gone", "friend");
    expect("error" in done).toBe(false);
    expect(tag.values["standing"]).toBe("friend");
    const again = await pickTagStage(session, group.id, tag.id, "standing", "gone", "friend");
    expect(again).toEqual({ error: "that value has already changed" });
    expect(await pickTagStage(session, "no-such-group", tag.id, "standing", "gone", "friend")).toHaveProperty("error");
  });
});
