// ---------------------------------------------------------------------------
// A pack and the game's shared scopes (patterkit design/shared-scopes.md,
// "Packs"). The folder sits above the project, so a pack carries a read-only
// snapshot of it: unpacking puts it in `game-scopes/` inside the project, where
// discovery looks first, and a merge of a returned pack never writes it back.
// The one thing that does come back is a World edit, through the project's
// synced copy, and the merge carries it to `game.scopes.json` and says so.
//
// Pinned hardest, as for the folder itself: NO FOLDER changes nothing. A
// project without one packs to the bytes it always did, and a pack from before
// packs carried scopes unpacks exactly as it always did.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { parseScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { ScopesFile } from "@wildwinter/scoperegistry/scopes";
import { PACK_MANIFEST, readPackManifest, runPack } from "../src/pack.js";
import type { PackManifest } from "../src/pack.js";
import { runUnpack, runUnpackMerge, UnsafeEntryError } from "../src/unpack.js";
import type { UnpackMergeResult } from "../src/unpack.js";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";
import type { PlannedWrite } from "../src/write.js";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

const PATTER: ScopesFile = {
  version: 1, owner: "Patter",
  scopes: [{ token: "patter", declarations: [{ name: "visits", type: "number", default: 1 }] }],
};
const GAME: ScopesFile = {
  version: 1, owner: "Game",
  scopes: [
    { token: "world", declarations: [{ name: "danger", type: "number", default: 0 }] },
    { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
  ],
};
// Not the canonical serialisation on purpose (two-space JSON, a trailing blank
// line): a pack carries the text as it is on disk, not a re-serialised copy.
const json = (file: ScopesFile): string => `${JSON.stringify(file, null, 2)}\n\n`;

/** A game folder: `root/.git`, `root/game-scopes/` with Patter's file and the
 *  game's own (none when `scopes` is false), and the example at
 *  `root/cards/saltmarsh.storylets`. */
function game(scopes = true): { root: string; project: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), "pack-scopes-"));
  mkdirSync(join(root, ".git"));
  const folder = join(root, "game-scopes");
  if (scopes) {
    mkdirSync(folder);
    writeFileSync(join(folder, "patter.scopes.json"), json(PATTER));
    writeFileSync(join(folder, "game.scopes.json"), json(GAME));
  }
  const project = join(root, "cards", "saltmarsh.storylets");
  cpSync(exampleDir, project, { recursive: true });
  return { root, project, folder };
}
const tempDir = (): string => mkdtempSync(join(tmpdir(), "unpack-scopes-"));

/** Rewrite one shard through a function over its parsed value. */
function edit(path: string, fn: (v: Record<string, any>) => void): void {
  const v = parseSource(readFileSync(path, "utf8")) as Record<string, any>;
  fn(v);
  writeFileSync(path, canonicalStringify(v));
}
const projectFile = (project: string): string => join(project, "saltmarsh.storyletproj");
const docksDeck = (project: string): string => join(project, "encounters", "decks", "docks.storyletdeck");

/** Write planned text files, as a caller commits them. */
function commit(writes: readonly PlannedWrite[]): void {
  for (const w of writes) {
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.content);
  }
}

/** Unpack a pack into a fresh folder and write everything it plans. */
async function unpackTo(bytes: Buffer, target = tempDir()): Promise<string> {
  const { shards, scopes } = await runUnpack(bytes, target);
  commit([...shards, ...scopes]);
  return target;
}

const entryNames = async (bytes: Buffer): Promise<string[]> =>
  Object.keys((await JSZip.loadAsync(bytes)).files).sort();

describe("pack: the game's shared scopes travel", () => {
  it("carries every scopes file as game-scopes/<name>, the text as it is on disk", async () => {
    const { project, folder } = game();
    writeFileSync(join(folder, "notes.txt"), "not a scopes file");
    const zip = await JSZip.loadAsync(await runPack(project));
    expect(await zip.file("game-scopes/game.scopes.json")!.async("string")).toBe(readFileSync(join(folder, "game.scopes.json"), "utf8"));
    expect(await zip.file("game-scopes/patter.scopes.json")!.async("string")).toBe(readFileSync(join(folder, "patter.scopes.json"), "utf8"));
    expect(zip.file("game-scopes/notes.txt")).toBeNull();
  });

  it("lists them in the manifest, sorted, apart from the shards", async () => {
    const { project } = game();
    const manifest = (await readPackManifest(await runPack(project)))!;
    expect(manifest.gameScopes).toEqual(["game.scopes.json", "patter.scopes.json"]);
    expect(manifest.files.some((f) => f.includes("game-scopes"))).toBe(false);
  });

  it("finds the folder as the loader does, the project's gameScopes override included", async () => {
    const { root, project } = game(false);
    mkdirSync(join(root, "shared", "scopes"), { recursive: true });
    writeFileSync(join(root, "shared", "scopes", "patter.scopes.json"), json(PATTER));
    edit(projectFile(project), (v) => { v.gameScopes = "../../shared/scopes"; });
    const bytes = await runPack(project);
    expect((await readPackManifest(bytes))!.gameScopes).toEqual(["patter.scopes.json"]);
    expect(await entryNames(bytes)).toContain("game-scopes/patter.scopes.json");
  });

  it("is still byte-reproducible", async () => {
    const { project } = game();
    const a = await runPack(project);
    const b = await runPack(project);
    expect(a.equals(b)).toBe(true);
  });
});

describe("pack: no folder, no change", () => {
  it("carries no scopes entry, and the manifest has no gameScopes key at all", async () => {
    const { project } = game(false);
    const bytes = await runPack(project);
    expect((await entryNames(bytes)).some((n) => n.startsWith("game-scopes"))).toBe(false);
    const manifest = JSON.parse(await (await JSZip.loadAsync(bytes)).file(PACK_MANIFEST)!.async("string")) as PackManifest;
    expect("gameScopes" in manifest).toBe(false);
  });

  it("packs to exactly the bytes it did before packs carried scopes", async () => {
    // A minimal project, written here so the pin moves only when the pack
    // format does. The hash is of the pack built by the code BEFORE this
    // change (2026-09-25), from the same files.
    const dir = join(mkdtempSync(join(tmpdir(), "pack-pin-")), "pin.storylets");
    mkdirSync(join(dir, "box"), { recursive: true });
    writeFileSync(join(dir, "pin.storyletproj"), '{\n  schema: "storylets/project@0",\n  project: { id: "p_pin", name: "Pin" },\n  world: { properties: [] },\n}\n');
    writeFileSync(join(dir, "box", "pin.storyletbox"), '{\n  schema: "storylets/box@0",\n  box: { id: "b_pin", title: "Pin" },\n}\n');
    const hash = createHash("sha256").update(await runPack(dir)).digest("hex");
    expect(hash).toBe("e11282ee3246b882ac0a2f4c52790ecee0befd07289525f0ccf53383dd1c5c33");
  });
});

describe("reading a pack: the snapshot is neither a shard nor an asset", () => {
  it("unpack plans it apart, for game-scopes/ inside the target", async () => {
    const { project } = game();
    const target = tempDir();
    const { shards, assets, scopes } = await runUnpack(await runPack(project), target);
    expect(scopes.map((w) => w.path)).toEqual([
      join(target, "game-scopes", "game.scopes.json"),
      join(target, "game-scopes", "patter.scopes.json"),
    ]);
    expect(shards.some((w) => w.path.includes("game-scopes"))).toBe(false);
    expect(assets).toEqual([]);
    expect(scopes.every((w) => !existsSync(w.path))).toBe(true);   // planned, not written
  });

  it("only a scopes file directly in the folder: anything else there is read as it always was", async () => {
    const zip = new JSZip();
    zip.file("game-scopes/game.scopes.json", json(GAME));
    zip.file("game-scopes/game-scopes.storyletbox", "{}");
    zip.file("game-scopes/deeper/x.scopes.json", "{}");
    const target = tempDir();
    const { shards, scopes } = await runUnpack(await zip.generateAsync({ type: "nodebuffer" }), target);
    expect(scopes.map((w) => w.path)).toEqual([join(target, "game-scopes", "game.scopes.json")]);
    expect(shards.map((w) => w.path).sort()).toEqual([
      join(target, "game-scopes", "deeper", "x.scopes.json"),
      join(target, "game-scopes", "game-scopes.storyletbox"),
    ]);
  });

  it("refuses a scopes entry that would land outside the target, as any other", async () => {
    // Built the way pack.test.ts builds a hostile pack: a same-length
    // placeholder, renamed in the finished bytes.
    const name = "/game-scopes/game.scopes.json";
    const placeholder = "x".repeat(name.length);
    const zip = new JSZip();
    zip.file(placeholder, "{}");
    const clean = await zip.generateAsync({ type: "nodebuffer" });
    const bytes = Buffer.from(clean.toString("latin1").split(placeholder).join(name), "latin1");
    await expect(runUnpack(bytes, tempDir())).rejects.toThrow(UnsafeEntryError);
  });
});

describe("unpack: the recipient's project finds the snapshot", () => {
  it("writes it into the project, and the loader there finds and uses it", async () => {
    const { project } = game();
    // A misspelt @patter name: the snapshot is what lets the recipient's
    // validate see it, as the sender's does.
    edit(docksDeck(project), (v) => {
      v.cards.find((c: { id: string }) => c.id === "c_rat_job").condition = "@patter.visitz >= 1";
    });
    const bytes = await runPack(project);
    const target = await unpackTo(bytes);

    const loaded = loadProject(target);
    expect(loaded.source!.gameScopes!.dir).toBe(join(target, "game-scopes"));
    expect(loaded.source!.gameScopes!.files).toEqual(["game.scopes.json", "patter.scopes.json"]);
    const said = runValidate(loaded, { checkBundle: false }).issues.map((i) => i.message).join("\n");
    expect(said).toContain("visitz");

    // Without the snapshot the same project works alone, and the name is
    // accepted unchecked: it is the snapshot doing the checking above.
    const alone = tempDir();
    commit((await runUnpack(bytes, alone)).shards);
    expect(runValidate(loadProject(alone), { checkBundle: false }).issues.map((i) => i.message).join("\n")).not.toContain("visitz");
  });

  it("a pack from before packs carried scopes unpacks exactly as it always did", async () => {
    // An old pack IS a pack of a project with no folder (the bytes are pinned
    // above): shards only, and the same shards.
    const { project } = game(false);
    const target = tempDir();
    const { shards, assets, scopes } = await runUnpack(await runPack(project), target);
    expect(scopes).toEqual([]);
    expect(assets).toEqual([]);
    for (const w of shards) expect(w.content).toBe(readFileSync(join(project, w.path.slice(target.length + 1)), "utf8"));
    commit(shards);
    expect(existsSync(join(target, "game-scopes"))).toBe(false);
    expect(loadProject(target).source!.gameScopes).toBeUndefined();
  });
});

describe("unpack --merge: the snapshot never comes back; a World edit does", () => {
  /** Send a pack from the sender's game, let the recipient unpack it and work
   *  in their copy, and pack it back. */
  async function roundTrip(work: (theirs: string) => void, scopes = true) {
    const sender = game(scopes);
    const sent = await runPack(sender.project);
    const theirs = await unpackTo(sent);
    work(theirs);
    const returned = await runPack(theirs);
    const before = scopes ? {
      game: readFileSync(join(sender.folder, "game.scopes.json"), "utf8"),
      patter: readFileSync(join(sender.folder, "patter.scopes.json"), "utf8"),
    } : undefined;
    return { ...sender, sent, returned, before };
  }
  const touchesScopes = (result: UnpackMergeResult): boolean =>
    [...result.writes, ...result.sidecars, ...result.assets].some((w) => w.path.includes("game-scopes"));

  /** A World edit as Storyletter makes it where the folder is inside the
   *  project: the game's file (the recipient's snapshot) and the project's copy. */
  function editWorld(theirs: string): void {
    const decls = [{ name: "danger", type: "number", default: 0 }, { name: "tide", type: "number", default: 3 }];
    edit(projectFile(theirs), (v) => { v.world.properties = decls; });
    const file: ScopesFile = { ...GAME, scopes: GAME.scopes.map((s) => (s.token === "world" ? { ...s, declarations: decls as never } : s)) };
    writeFileSync(join(theirs, "game-scopes", "game.scopes.json"), json(file));
  }

  it("ignores a MODIFIED snapshot in the returned pack: nothing is written to any game-scopes folder", async () => {
    const { project, folder, sent, returned, before } = await roundTrip((theirs) => {
      writeFileSync(join(theirs, "game-scopes", "patter.scopes.json"), json({ ...PATTER, owner: "Somebody else" }));
      writeFileSync(join(theirs, "game-scopes", "game.scopes.json"), json({ ...GAME, scopes: GAME.scopes.filter((s) => s.token !== "player") }));
      // ...and an ordinary edit, so the merge has something to do.
      const p = docksDeck(theirs);
      writeFileSync(p, readFileSync(p, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    });
    const result = await runUnpackMerge(returned, sent, project);
    expect(touchesScopes(result)).toBe(false);
    expect(result.gameWorld).toBeUndefined();
    commit(result.writes);
    expect(readFileSync(join(folder, "game.scopes.json"), "utf8")).toBe(before!.game);
    expect(readFileSync(join(folder, "patter.scopes.json"), "utf8")).toBe(before!.patter);
    expect(existsSync(join(project, "game-scopes"))).toBe(false);
    expect(readFileSync(docksDeck(project), "utf8")).toContain("dock-work");
  });

  it("carries a World edit to game.scopes.json, keeping the file's other scopes, and reports it", async () => {
    const { project, folder, sent, returned } = await roundTrip(editWorld);
    const result = await runUnpackMerge(returned, sent, project);
    expect(touchesScopes(result)).toBe(false);
    const write = result.gameWorld as PlannedWrite;
    expect(write.path).toBe(join(folder, "game.scopes.json"));
    const file = parseScopesFile(write.content, "game.scopes.json").file!;
    expect(file.scopes.find((s) => s.token === "world")!.declarations!.map((d) => d.name)).toEqual(["danger", "tide"]);
    expect(file.scopes.find((s) => s.token === "player")).toEqual(GAME.scopes[1]);

    // Committed, the sender's project and the shared file agree: the edit is
    // the game's now, and the next save's re-sync keeps it rather than losing it.
    commit([...result.writes, write]);
    const loaded = loadProject(project);
    const said = runValidate(loaded, { checkBundle: false }).issues.map((i) => i.message).join("\n");
    expect(said).not.toContain("differ");
    expect(loaded.source!.gameScopes!.merged.spec.scopes.find((s) => s.token === "world")!.declarations!.map((d) => d.name))
      .toEqual(["danger", "tide"]);
  });

  it("writes nothing to game.scopes.json when the World is unchanged", async () => {
    const { project, sent, returned } = await roundTrip((theirs) => {
      const p = docksDeck(theirs);
      writeFileSync(p, readFileSync(p, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    });
    const result = await runUnpackMerge(returned, sent, project);
    expect(result.gameWorld).toBeUndefined();
    expect(touchesScopes(result)).toBe(false);
  });

  it("with no folder here, a World edit merges into the project and nothing else", async () => {
    const { root, project, sent, returned } = await roundTrip((theirs) => {
      edit(projectFile(theirs), (v) => { v.world.properties.push({ name: "tide", type: "number", default: 3 }); });
    }, false);
    const result = await runUnpackMerge(returned, sent, project);
    expect(result.gameWorld).toBeUndefined();
    expect(result.writes.find((w) => w.path === projectFile(project))!.content).toContain("tide");
    expect(existsSync(join(root, "game-scopes"))).toBe(false);
  });

  it("says why, and writes nothing, when game.scopes.json won't parse", async () => {
    const { project, folder, sent, returned } = await roundTrip(editWorld);
    writeFileSync(join(folder, "game.scopes.json"), "{ not json");
    const result = await runUnpackMerge(returned, sent, project);
    expect(result.gameWorld).toEqual({ path: join(folder, "game.scopes.json"), error: expect.stringContaining("game.scopes.json") });
  });
});
