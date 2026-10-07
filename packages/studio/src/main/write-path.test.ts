// The write path when version control says no (the Storyletter review of
// 2026-10, items 1 and 12). Every refusal here is a real one from simple-vc-lib:
// a provider that holds a file for somebody else, or that will not let a path be
// written, installed with `setProvider` exactly as a lock-based VCS would be.
//
// What has to hold: a batch lands whole or not at all, nothing is deleted after
// a write that did not land, the message names the file and who holds it, a
// refused commit leaves main's project as the disk has it, and an undo that
// cannot write puts its step back.

import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FilesystemProvider, clearProvider, setProvider } from "@wildwinter/simple-vc-lib";
import type { VCFileStatus, VCResult, VCStatusOptions } from "@wildwinter/simple-vc-lib";
import { openProject } from "./project.js";
import { History, applyStates } from "./history.js";
import { moveCardsOnCanvas, redo, renameDeck, saveCard, setProjectWrittenListener, undo } from "./mutate.js";
import type { ProjectSession } from "./project.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratchProject(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-write-path-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";
const decksDir = (session: ProjectSession): string => join(session.loaded.dir, "encounters", "decks");
const docksFile = (session: ProjectSession): string => join(decksDir(session), "docks.storyletdeck");
const ambushId = (session: ProjectSession): string =>
  session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!.id;
const titleOf = (session: ProjectSession, id: string): string | undefined =>
  session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === id)?.title;

/** The filesystem, except that some paths are refused (a read-only path the
 *  VCS will not check out) and some are held by another user. */
class StubbornProvider extends FilesystemProvider {
  constructor(
    private readonly refuse: (path: string) => boolean,
    private readonly heldBy: (path: string) => string | undefined = () => undefined,
  ) { super(); }

  override async prepareToWriteAsync(filePath: string): Promise<VCResult> {
    if (this.refuse(filePath)) return { success: false, status: "error", message: `'${filePath}' is read-only and could not be checked out` };
    return super.prepareToWriteAsync(filePath);
  }

  override async statusAsync(filePaths: string[], options?: VCStatusOptions): Promise<VCFileStatus[]> {
    const statuses = await super.statusAsync(filePaths, options);
    return statuses.map((s) => {
      const who = this.heldBy(s.filePath);
      return who === undefined ? s : { ...s, lockedBy: [who] };
    });
  }
}

const same = (a: string, b: string): boolean => resolve(a) === resolve(b);

afterEach(() => {
  clearProvider();
  setProjectWrittenListener(undefined);
});

describe("a refused write (review 2026-10, item 1)", () => {
  it("a deck rename whose new path is refused keeps the deck, and records no step", async () => {
    const session = scratchProject();
    const renamed = join(decksDir(session), "harbour.storyletdeck");
    setProvider(new StubbornProvider((p) => same(p, renamed)));

    const result = await renameDeck(session, docks, { gameId: "harbour" });

    expect("error" in result).toBe(true);
    // The deck is still where it was: the delete of the old path never ran.
    expect(existsSync(docksFile(session))).toBe(true);
    expect(existsSync(renamed)).toBe(false);
    // And no undo step was recorded for a change that did not happen.
    clearProvider();
    expect(await undo(session)).toBeNull();
  });

  it("deletes nothing when the batch it rides with does not land", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-apply-"));
    const old = join(dir, "old.storyletdeck");
    const next = join(dir, "next.storyletdeck");
    writeFileSync(old, "old", "utf8");
    setProvider(new StubbornProvider((p) => same(p, next)));

    const applied = await applyStates([{ path: next, content: "new" }, { path: old, content: null }]);

    expect(applied.ok).toBe(false);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(next)).toBe(false);
  });

  it("writes none of a batch when one file in it is held by someone else, and names them", async () => {
    const session = scratchProject();
    const before = readFileSync(docksFile(session), "utf8");
    setProvider(new StubbornProvider(() => false, (p) => (same(p, docksFile(session)) ? "bob@bob-ws" : undefined)));

    const result = await saveCard(session, docks, ambushId(session), { title: "Held elsewhere" });

    expect(result).toMatchObject({ error: expect.stringContaining("locked by bob@bob-ws") });
    expect((result as { error: string }).error).toContain("docks.storyletdeck");
    expect(readFileSync(docksFile(session), "utf8")).toBe(before);
  });
});

describe("main's project after a refused commit (review 2026-10, item 12)", () => {
  it("is what the disk says, so the next write carries no phantom edit", async () => {
    const session = scratchProject();
    const ambush = ambushId(session);
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!.id;
    setProvider(new StubbornProvider((p) => same(p, docksFile(session))));

    const refused = await saveCard(session, docks, ambush, { title: "Never written" });
    expect("error" in refused).toBe(true);
    // The in-memory project was reloaded from disk on the way out.
    expect(titleOf(session, ambush)).toBe("Ambush at the ford");

    clearProvider();
    const saved = await saveCard(session, docks, ratJob, { title: "Rat X" });
    expect("error" in saved).toBe(false);
    const onDisk = readFileSync(docksFile(session), "utf8");
    expect(onDisk).not.toContain("Never written");
    expect(onDisk).toContain("Rat X");
  });

  it("an undo that cannot write puts its step back and says so", async () => {
    const session = scratchProject();
    const ambush = ambushId(session);
    await saveCard(session, docks, ambush, { title: "Edited" });
    setProvider(new StubbornProvider((p) => same(p, docksFile(session))));

    const failed = await undo(session);
    expect(failed).toMatchObject({ error: expect.any(String) });
    expect(titleOf(session, ambush)).toBe("Edited");

    // The step is still there to undo once the file can be written.
    clearProvider();
    const undone = await undo(session);
    expect(undone).not.toBeNull();
    expect(undone && "error" in undone).toBe(false);
    expect(titleOf(session, ambush)).toBe("Ambush at the ford");
  });

  it("a redo that cannot write puts its step back and says so", async () => {
    const session = scratchProject();
    const ambush = ambushId(session);
    await saveCard(session, docks, ambush, { title: "Edited" });
    await undo(session);
    setProvider(new StubbornProvider((p) => same(p, docksFile(session))));

    expect(await redo(session)).toMatchObject({ error: expect.any(String) });
    clearProvider();
    await redo(session);
    expect(titleOf(session, ambush)).toBe("Edited");
  });
});

describe("the undo history's cap (review 2026-10, item 27)", () => {
  it("keeps the newest hundred steps and drops the oldest", () => {
    const history = new History();
    for (let i = 0; i < 150; i++) history.record(`step ${i}`, `struct:${i}`, [], []);
    let steps = 0;
    while (history.undo() !== undefined) steps++;
    expect(steps).toBe(100);
  });
});

describe("the written listener (review 2026-10, smaller items)", () => {
  it("is told when a write lands, and not when nothing was written", async () => {
    const session = scratchProject();
    let told = 0;
    setProjectWrittenListener(() => { told++; });
    // An arrangement that moves nothing plans no write.
    await moveCardsOnCanvas(session, docks, []);
    expect(told).toBe(0);
    await saveCard(session, docks, ambushId(session), { title: "Written" });
    expect(told).toBe(1);
  });
});
