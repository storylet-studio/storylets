// Undo and redo refuse, BEFORE writing, a step that would change a shard somebody else holds: the same rule
// the editor's locks read (lockedBy), so a step can never write what the page would not let the author type
// into. The refusal names the file's owner and its holder, and the step stays where it was, to be tried again
// once they let go (the shell history's own answer for a write that could not land).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject, shardRefs } from "./project.js";
import { redo, saveCard, undo } from "./mutate.js";
import { setExtensionValue } from "./mutate/extensions.js";
import { resetShardStatus, setStatusReader } from "./vc.js";
import type { ProjectSession } from "./project.js";
import type { VCFileStatus } from "@wildwinter/simple-vc-lib";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));
const probeDir = fileURLToPath(new URL("../../../ops/test/fixtures/probe-extension.storylets", import.meta.url));

function scratch(from: string): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-held-")), "copy.storylets");
  cpSync(from, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

/** Version control in which `held` (a shard key) is held by bo, and everything else is free. */
function holding(session: ProjectSession, ...held: string[]): void {
  const paths = new Set(shardRefs(session).filter((r) => held.includes(r.key)).map((r) => r.path));
  resetShardStatus();
  setStatusReader(async (all) => all.map((p): VCFileStatus => ({
    filePath: p, system: "perforce", writable: !paths.has(p), ...(paths.has(p) ? { lockedBy: ["bo@bo-ws"] } : {}),
  })));
}

beforeEach(() => resetShardStatus());
afterEach(() => setStatusReader(null));

describe("an undo or redo of a step on a held shard", () => {
  it("is refused before writing, names the extension, its box and the holder, and stays to be retried", async () => {
    const session = scratch(probeDir);
    const box = session.dto.boxes[0]!.id;
    const shard = join(session.loaded.dir, "harbour", "probe.storyletextension");
    await setExtensionValue(session, "probe", box, "theme", "pitch");
    const edited = readFileSync(shard, "utf8");

    holding(session, `ext:${box}:probe`);
    const refused = await undo(session);
    expect(refused).toEqual({ error: expect.stringContaining("Probe's data in the box “harbour” is locked by bo@bo-ws") });
    expect(readFileSync(shard, "utf8")).toBe(edited);    // nothing written
    expect(session.history.canUndo).toBe(true);           // the step is still there

    holding(session);                                      // bo lets go
    expect(await undo(session)).not.toHaveProperty("error");
    expect(readFileSync(shard, "utf8")).not.toBe(edited);

    holding(session, `ext:${box}:probe`);
    expect(await redo(session)).toEqual({ error: expect.stringContaining("Probe's data in the box “harbour” is locked by bo@bo-ws") });
    expect(session.history.canRedo).toBe(true);
  });

  it("is refused for a box's own shard too, naming the deck and the holder", async () => {
    const session = scratch(exampleDir);
    const deck = session.dto.boxes[0]!.decks[0]!;
    const card = deck.cards[0]!;
    await saveCard(session, deck.id, card.id, { title: "Renamed" });

    holding(session, `deck:${deck.id}`);
    const refused = await undo(session);
    expect(refused).toEqual({ error: expect.stringContaining(`The deck “${deck.title ?? deck.gameId}” is locked by bo@bo-ws`) });
    expect(session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === card.id)?.title).toBe("Renamed");
    expect(session.history.canUndo).toBe(true);
  });

  it("goes ahead when what is held is not in the step: another extension's shard, the box's own", async () => {
    const session = scratch(probeDir);
    const box = session.dto.boxes[0]!.id;
    await setExtensionValue(session, "probe", box, "theme", "pitch");
    holding(session, `box:${box}`, `ext:@project:probe`);
    expect(await undo(session)).not.toHaveProperty("error");
  });
});
