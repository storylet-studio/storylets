// ---------------------------------------------------------------------------
// The send envelope: pack -> unpack round trips losslessly, a returned pack
// merges back by id, and a hostile pack cannot write outside its target.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PACK_MANIFEST, readPackManifest, runPack } from "../src/pack.js";
import { UnsafeEntryError, isUnsafeEntry, runUnpack, runUnpackMerge } from "../src/unpack.js";
import { MergeInputError } from "../src/merge.js";
import { loadProject } from "../src/load.js";
import { runExport } from "../src/export.js";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

/** A throwaway copy of the example project. */
function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pack-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  return dir;
}
const tempDir = (): string => mkdtempSync(join(tmpdir(), "unpack-"));

const deckPath = join("encounters", "decks", "docks.storyletdeck");

/** A tiny but REAL PNG (1x1, transparent). Real matters: the point of these
 *  tests is that bytes survive a round trip, and text with a few high bytes in it
 *  would survive a utf8 read that a PNG does not. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082", "hex");

/** Reference an asset from the box's spatial group, so it is not an orphan.
 *  Written into the shard directly: the pack op reads shards, not the editor. */
function referenceAsset(dir: string, ...files: string[]): boolean {
  const tags = join(dir, "encounters", "tags.storylettags");
  const text = readFileSync(tags, "utf8");
  const shard = parseSource(text) as {
    groups: { id: string; templates?: Record<string, unknown> }[];
  };
  const group = shard.groups[0];
  if (!group) return false;
  group.templates = {
    ...group.templates,
    spatial: {
      ...(group.templates?.["spatial"] as Record<string, unknown> | undefined),
      map: true,
      backgrounds: files.map((file, i) => ({ id: `g_${i + 1}`, file, x: 0, y: 0, width: 100, height: 50 })),
    },
  };
  writeFileSync(tags, canonicalStringify(shard));
  return true;
}

/**
 * Put an asset in a box, REFERENCE it from the box's map, and say whether the
 * project asks for assets to travel.
 *
 * Referencing is the default because an unreferenced file is an orphan, and a
 * pack deliberately leaves those behind - so a fixture that skipped this step
 * would be testing the orphan rule while claiming to test something else.
 */
function withAsset(dir: string, opts: { packAssets?: boolean; reference?: boolean } = {}): string {
  mkdirSync(join(dir, "encounters", "assets"), { recursive: true });
  writeFileSync(join(dir, "encounters", "assets", "site-plan.png"), PNG);
  if (opts.reference !== false) referenceAsset(dir, "site-plan.png");
  if (opts.packAssets !== undefined) {
    const projFile = join(dir, readdirSync(dir).find((f) => f.endsWith(".storyletproj"))!);
    const text = readFileSync(projFile, "utf8");
    writeFileSync(projFile, text.replace(
      /export: \{/, `export: {\n    packAssets: ${String(opts.packAssets)},`));
  }
  return dir;
}

describe("an unresolved merge cannot travel", () => {
  // merge.ts has said since it was written that "a lingering sidecar is a
  // validate error, so an unresolved merge cannot reach CI or export". Only
  // runValidate enforced it: export and pack both shipped happily, and a pack
  // is the worst of the two, because the merged model resolves conflicted
  // values PROVISIONALLY to ours - so it handed somebody their own discarded
  // edit back as though it were agreed. Pinned here, in both directions.

  it("pack refuses, naming the sidecar", async () => {
    const dir = scratch();
    writeFileSync(join(dir, `${deckPath}${".storyletconflict"}`), "conflicts here");
    await expect(runPack(dir)).rejects.toThrow(/unresolved merge/i);
  });

  it("export refuses, as an error issue rather than a bundle", () => {
    const dir = scratch();
    writeFileSync(join(dir, `${deckPath}${".storyletconflict"}`), "conflicts here");
    const result = runExport(loadProject(dir));
    expect(result.bundle).toBeUndefined();
    expect(result.issues.some((i) => i.severity === "error" && /unresolved merge sidecar/.test(i.message))).toBe(true);
  });

  it("and both are fine once the sidecar is gone", async () => {
    // Not vacuous: the same project packs and exports when nothing is pending.
    const dir = scratch();
    await expect(runPack(dir)).resolves.toBeInstanceOf(Buffer);
    expect(runExport(loadProject(dir)).bundle).toBeDefined();
  });
});

describe("what a pack ships", () => {
  it("ignores shards inside a dot-directory, as the loader does", async () => {
    // Three walkers existed, with three skip rules, and pack's skipped nothing.
    // So a shard in any dot-directory - an editor backup, a stray .trash, a
    // vendored .git - was PACKED although `validate` and `export` had never
    // read it, and the reviewer received content the sender's own project did
    // not have. What a pack ships and what the project IS must be one set.
    const dir = scratch();
    mkdirSync(join(dir, ".backup", "decks"), { recursive: true });
    writeFileSync(join(dir, ".backup", "decks", "old.storyletdeck"),
      readFileSync(join(dir, deckPath), "utf8"));

    const names = Object.keys((await JSZip.loadAsync(await runPack(dir))).files);
    expect(names.some((n) => n.includes(".backup"))).toBe(false);
    // ...and the real deck is still there, so the check is not vacuous.
    expect(names.some((n) => n.endsWith("docks.storyletdeck"))).toBe(true);
  });
});

describe("a pack and its assets", () => {
  // Two switches, both off by default (2026-08-07): the project says whether its
  // pictures travel, and a caller can override that for one delivery. Some
  // projects would benefit from sending them and others never would.

  it("leaves them behind by default", async () => {
    const bytes = await runPack(withAsset(scratch()));
    const manifest = await readPackManifest(bytes);
    expect(manifest?.assets).toBeUndefined();
    const names = Object.keys((await JSZip.loadAsync(bytes)).files);
    expect(names.some((n) => n.includes("assets/"))).toBe(false);
  });

  it("carries them when the PROJECT asks", async () => {
    const bytes = await runPack(withAsset(scratch(), { packAssets: true }));
    expect((await readPackManifest(bytes))?.assets).toEqual(["encounters/assets/site-plan.png"]);
  });

  it("lets one delivery override the project either way", async () => {
    // A designer gets the site plan; a writer does not, from the same project.
    const off = withAsset(scratch(), { packAssets: false });
    expect((await readPackManifest(await runPack(off, { assets: true })))?.assets).toHaveLength(1);
    const on = withAsset(scratch(), { packAssets: true });
    expect((await readPackManifest(await runPack(on, { assets: false })))?.assets).toBeUndefined();
  });

  it("leaves ORPHANS behind: a delivery carries what a map uses", async () => {
    // Ordinary work makes orphans (undoing an import keeps the file on purpose),
    // and a pack should carry the project's content rather than everything that
    // has ever been in the folder. Nothing is lost: the sender still has it.
    const source = withAsset(scratch(), { packAssets: true });
    writeFileSync(join(source, "encounters", "assets", "old-draft.png"), PNG);
    const manifest = await readPackManifest(await runPack(source));
    expect(manifest?.assets).toEqual(["encounters/assets/site-plan.png"]);
  });

  it("round trips the BYTES, which reading them as text would not", async () => {
    // The whole reason assets needed their own path: a PNG read with utf8 and
    // written back is not the same PNG.
    const source = withAsset(scratch(), { packAssets: true });
    const bytes = await runPack(source);
    const target = tempDir();
    const { shards, assets } = await runUnpack(bytes, target);
    expect(shards.some((w) => w.path.includes("assets"))).toBe(false);   // not a shard
    expect(assets).toHaveLength(1);
    for (const a of assets) {
      mkdirSync(join(a.path, ".."), { recursive: true });
      writeFileSync(a.path, a.bytes);
    }
    expect(readFileSync(join(target, "encounters", "assets", "site-plan.png")).equals(PNG)).toBe(true);
  });

  it("lists them apart from the shards, so a reader treats them differently", async () => {
    const bytes = await runPack(withAsset(scratch(), { packAssets: true }));
    const manifest = await readPackManifest(bytes);
    expect(manifest?.files.some((f) => f.includes("assets/"))).toBe(false);
    expect(manifest?.assets).toEqual(["encounters/assets/site-plan.png"]);
  });
});

describe("a returned pack's assets", () => {
  it("adds a picture we do not have, and KEEPS one we do", async () => {
    // Nothing to three-way inside a PNG, so the only choices are theirs, ours,
    // or refuse. Ours: an original must never be silently replaced by somebody's
    // re-saved copy, and a picture nobody has is worth having.
    const source = withAsset(scratch(), { packAssets: true });
    const base = await runPack(source);

    // They re-save the first picture, PLACE a second, and leave a third lying in
    // the folder without placing it.
    const theirCopy = join(source, "encounters", "assets", "site-plan.png");
    writeFileSync(theirCopy, Buffer.concat([PNG, Buffer.from([0])]));
    writeFileSync(join(source, "encounters", "assets", "upper-floor.png"), PNG);
    writeFileSync(join(source, "encounters", "assets", "never-placed.png"), PNG);
    referenceAsset(source, "site-plan.png", "upper-floor.png");
    const returned = await runPack(source);

    // Our copy is the original.
    const ours = withAsset(scratch(), { packAssets: true });
    const merged = await runUnpackMerge(returned, base, ours);
    expect(merged.keptAssets).toEqual(["encounters/assets/site-plan.png"]);
    expect(merged.assets.map((a) => a.path.slice(ours.length + 1).split(sep).join("/")))
      .toEqual(["encounters/assets/upper-floor.png"]);
    // A file lying in their folder that they never PLACED is not part of the map,
    // so it neither travels nor arrives.
    expect(merged.assets.some((a) => a.path.includes("never-placed"))).toBe(false);
    expect(merged.keptAssets.some((k) => k.includes("never-placed"))).toBe(false);
    // And the merge planned no text write for any of them.
    expect(merged.writes.some((w) => w.path.includes("assets"))).toBe(false);
  });

  it("never hands a picture to the JSON5 parser", async () => {
    // The trap this shape exists to avoid: the merge walks the returned pack and
    // parses every entry, so a PNG in that walk would throw on somebody's plan.
    const source = withAsset(scratch(), { packAssets: true });
    const base = await runPack(source);
    const returned = await runPack(source);
    await expect(runUnpackMerge(returned, base, withAsset(scratch()))).resolves.toBeDefined();
  });
});

describe("pack", () => {
  it("carries every shard, and only shards", async () => {
    const bytes = await runPack(scratch());
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();

    expect(names).toContain(PACK_MANIFEST);
    expect(names).toContain("saltmarsh.storyletproj");
    expect(names).toContain("encounters/decks/docks.storyletdeck");
    // A pack is SOURCE. The compiled bundle is generated, so shipping it would
    // put a second, staler answer in the envelope.
    expect(names.some((n) => n.endsWith(".storyletsc"))).toBe(false);
    for (const n of names.filter((x) => x !== PACK_MANIFEST)) {
      expect(n).toMatch(/\.storylet(proj|box|tags|hands|deck)$/);
    }
  });

  it("names the project in its manifest, with the file list sorted", async () => {
    const manifest = (await readPackManifest(await runPack(scratch())))!;
    expect(manifest.schema).toBe("storylets/pack@0");
    expect(manifest.project.name).toBe("Saltmarsh");
    expect(manifest.project.id).toBeTruthy();
    expect(manifest.files).toEqual([...manifest.files].sort());
    expect(manifest.files).toContain("encounters/decks/docks.storyletdeck");
  });

  it("is byte-reproducible, so an unchanged project packs identically", async () => {
    // No wall-clock mtimes anywhere in the bytes: a pack can then be hashed
    // and diffed, and a re-pack of untouched source is provably a no-op.
    const dir = scratch();
    const one = await runPack(dir);
    const two = await runPack(dir);
    expect(one.equals(two)).toBe(true);
  });

  it("packs from a path inside the project, not just its root", async () => {
    const dir = scratch();
    const fromInside = await runPack(join(dir, "encounters", "decks"));
    expect(fromInside.equals(await runPack(dir))).toBe(true);
  });

  it("refuses a directory that is not a project", async () => {
    await expect(runPack(tempDir())).rejects.toThrow(/not a storylets project/);
  });
});

describe("unpack", () => {
  it("round trips: unpacked shards are byte-identical to the originals", async () => {
    const source = scratch();
    const bytes = await runPack(source);
    const target = tempDir();
    const { shards: writes } = await runUnpack(bytes, target);

    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      mkdirSync(join(w.path, ".."), { recursive: true });
      writeFileSync(w.path, w.content);
    }
    // Lossless is the whole promise: the raw bytes travel, so hand edits and
    // comments survive rather than being re-serialised through the model.
    for (const w of writes) {
      const rel = w.path.slice(target.length + 1);
      expect(readFileSync(w.path, "utf8")).toBe(readFileSync(join(source, rel), "utf8"));
    }
    // And the result is a project the loader accepts.
    expect(loadProject(target).source).toBeDefined();
  });

  it("plans writes without touching the disk itself", async () => {
    const bytes = await runPack(scratch());
    const target = tempDir();
    const { shards: writes } = await runUnpack(bytes, target);
    expect(writes.every((w) => !existsSync(w.path))).toBe(true);
  });

  /** A pack carrying a raw hostile entry name.
   *
   *  JSZip's writer normalises a hostile name away, so it cannot build this
   *  fixture directly. Instead: add a placeholder of the same byte length, then
   *  rewrite the name in the finished bytes. The name appears in the local
   *  header and the central directory, both the same length, so every offset
   *  still holds. */
  async function hostilePack(name: string): Promise<Buffer> {
    const placeholder = "x".repeat(name.length);
    const zip = new JSZip();
    zip.file(placeholder, "{}");
    const clean = await zip.generateAsync({ type: "nodebuffer" });
    const bytes = Buffer.from(clean.toString("latin1").split(placeholder).join(name), "latin1");
    expect(bytes.toString("latin1")).toContain(name);   // the fixture really is hostile
    return bytes;
  }

  it("refuses an absolute entry path outright", async () => {
    // JSZip's loader keeps a leading slash, so this reaches the name check.
    await expect(runUnpack(await hostilePack("/etc/evil.storyletproj"), tempDir()))
      .rejects.toThrow(UnsafeEntryError);
  });

  it("never plans a write outside the target, however the entry is spelled", async () => {
    // The property that matters, asserted without assuming WHICH layer catches
    // it. Traversal is a case in point: JSZip's loader collapses "../../evil"
    // to "evil" before we ever see the name, so this passes by containment
    // rather than by refusal - and would still pass under a reader that did
    // not collapse it, because the resolved path is checked too.
    const target = tempDir();
    for (const name of ["../../evil.storyletproj", "a/../../../evil.storyletproj"]) {
      let writes: { path: string }[] = [];
      try {
        writes = (await runUnpack(await hostilePack(name), target)).shards;
      } catch (e) {
        expect(e).toBeInstanceOf(UnsafeEntryError);
        continue;
      }
      for (const w of writes) {
        expect(resolve(w.path).startsWith(resolve(target) + sep)).toBe(true);
      }
    }
  });

  it("knows an unsafe entry from a safe one", () => {
    expect(isUnsafeEntry("../escape")).toBe(true);
    expect(isUnsafeEntry("/etc/passwd")).toBe(true);
    expect(isUnsafeEntry("C:\\windows")).toBe(true);
    expect(isUnsafeEntry("a/../../b")).toBe(true);
    expect(isUnsafeEntry("encounters/decks/docks.storyletdeck")).toBe(false);
    expect(isUnsafeEntry("deep/a/../b.storyletdeck")).toBe(false);   // stays inside
  });
});

describe("unpack --merge: the return leg", () => {
  /** Send a pack, let the other author edit their copy, and pack it back. */
  async function roundTrip(edit: (theirCopy: string) => void) {
    const ours = scratch();
    const sent = await runPack(ours);                 // the base we keep
    const theirs = scratch();
    edit(theirs);
    const returned = await runPack(theirs);
    return { ours, sent, returned };
  }

  it("folds a returned edit back in by id", async () => {
    const { ours, sent, returned } = await roundTrip((dir) => {
      const p = join(dir, deckPath);
      writeFileSync(p, readFileSync(p, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    });

    const result = await runUnpackMerge(returned, sent, ours);
    expect(result.conflicts).toBe(0);
    const deckWrite = result.writes.find((w) => w.path.endsWith("docks.storyletdeck"))!;
    expect(deckWrite.content).toContain("dock-work");
    expect(result.shards.every((s) => !s.added)).toBe(true);
  });

  it("keeps our own edit to a different field of the same card", async () => {
    // The point of an id-keyed merge rather than a text one: two people can
    // edit one card without colliding, so long as they touch different fields.
    const { ours, sent, returned } = await roundTrip((dir) => {
      const p = join(dir, deckPath);
      writeFileSync(p, readFileSync(p, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    });
    const oursDeck = join(ours, deckPath);
    writeFileSync(oursDeck, readFileSync(oursDeck, "utf8").replace('title: "A rat job"', 'title: "Wharf work"'));

    const result = await runUnpackMerge(returned, sent, ours);
    const deckWrite = result.writes.find((w) => w.path.endsWith("docks.storyletdeck"))!;
    expect(deckWrite.content).toContain("dock-work");    // theirs
    expect(deckWrite.content).toContain("Wharf work");   // ours
    expect(result.conflicts).toBe(0);
  });

  it("reports a conflict, with a sidecar, when both edited the same field", async () => {
    const { ours, sent, returned } = await roundTrip((dir) => {
      const p = join(dir, deckPath);
      writeFileSync(p, readFileSync(p, "utf8").replace('title: "A rat job"', 'title: "Their title"'));
    });
    const oursDeck = join(ours, deckPath);
    writeFileSync(oursDeck, readFileSync(oursDeck, "utf8").replace('title: "A rat job"', 'title: "Our title"'));

    const result = await runUnpackMerge(returned, sent, ours);
    expect(result.conflicts).toBeGreaterThan(0);
    expect(result.sidecars.some((s) => s.path.endsWith(".storyletconflict"))).toBe(true);
  });

  it("takes a shard the other author added", async () => {
    const { ours, sent, returned } = await roundTrip((dir) => {
      const p = join(dir, "encounters", "decks", "rumours.storyletdeck");
      writeFileSync(p, '{\n  schema: "storylets/deck@0",\n  deck: { gameId: "rumours", id: "k_rumours", properties: [] },\n  cards: [],\n}\n');
    });

    const result = await runUnpackMerge(returned, sent, ours);
    const added = result.shards.find((s) => s.path.endsWith("rumours.storyletdeck"))!;
    expect(added.added).toBe(true);
    expect(result.writes.some((w) => w.path.endsWith("rumours.storyletdeck"))).toBe(true);
  });

  it("leaves a shard the other author deleted alone", async () => {
    // Not propagating a whole-file delete is the safe reading: it cannot
    // destroy work, and the sender can always delete it themselves.
    const { ours, sent, returned } = await roundTrip((dir) => {
      // Repack without the deck by packing a copy that never had it.
      const p = join(dir, deckPath);
      writeFileSync(p, readFileSync(p, "utf8"));
    });
    const stripped = await JSZip.loadAsync(returned);
    stripped.remove("encounters/decks/docks.storyletdeck");
    const withoutDeck = await stripped.generateAsync({ type: "nodebuffer" });

    const result = await runUnpackMerge(withoutDeck, sent, ours);
    expect(result.writes.some((w) => w.path.endsWith("docks.storyletdeck"))).toBe(false);
    expect(existsSync(join(ours, deckPath))).toBe(true);
  });

  it("is pure: nothing is written until the caller commits", async () => {
    const { ours, sent, returned } = await roundTrip((dir) => {
      const p = join(dir, deckPath);
      writeFileSync(p, readFileSync(p, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    });
    const before = readFileSync(join(ours, deckPath), "utf8");
    await runUnpackMerge(returned, sent, ours);
    expect(readFileSync(join(ours, deckPath), "utf8")).toBe(before);
  });

  // --- the cheap provenance check (pack-merge-back section 7, cheap variant) --

  const projFile = "saltmarsh.storyletproj";
  const setProjectId = (dir: string, id: string): void => {
    const p = join(dir, projFile);
    writeFileSync(p, readFileSync(p, "utf8").replace(/id:\s*"[^"]*"/, `id: "${id}"`));
  };

  it("WARNS about a pack from a different project, and merges anyway", async () => {
    // Warn, never refuse. An id can legitimately differ - a fork, an id reissued
    // after a template copy - and a check with no override is a wall rather than a
    // guard, whose only escape would be hand-editing a project file to fake an id.
    // It also matches this file's own fail-soft reasoning: a wrong-project merge
    // degrades into visible, recoverable conflicts, just a great many of them.
    const ours = scratch();
    const sent = await runPack(ours);
    const theirs = scratch();
    setProjectId(theirs, "proj_elsewhere");
    const returned = await runPack(theirs);
    const result = await runUnpackMerge(returned, sent, ours);
    expect(result.provenance.wrongProject).toBe(true);
    expect(result.provenance.mismatch).toBe(true);
    expect(result.writes.length).toBeGreaterThan(0);   // it merged
  });

  it("names both ids, so the author has something to check against", async () => {
    const ours = scratch();
    const sent = await runPack(ours);
    const theirs = scratch();
    setProjectId(theirs, "proj_elsewhere");
    const returned = await runPack(theirs);
    const { provenance } = await runUnpackMerge(returned, sent, ours);
    expect(provenance.message).toMatch(/proj_elsewhere/);
    expect(provenance.message).toMatch(/proj_salt/);
  });

  it("catches the WRONG ANCESTOR, which two ids cannot see", async () => {
    // The likeliest slip in the flow, and the reason for a third id: the author
    // picks the right returned pack and the wrong base - the second prompt,
    // answered from memory about which outbox file went out in March. Returned
    // versus project agrees cleanly, so a two-way check passes it and the merge
    // mints exactly the pile of spurious conflicts the check exists to prevent.
    const ours = scratch();
    const strangerDir = scratch();
    setProjectId(strangerDir, "proj_stranger");
    const wrongBase = await runPack(strangerDir);       // an ancestor from elsewhere
    const returned = await runPack(scratch());          // the RIGHT project, returned
    const { provenance } = await runUnpackMerge(returned, wrongBase, ours);
    expect(provenance.wrongProject).toBe(false);        // these two do agree
    expect(provenance.wrongBase).toBe(true);
    expect(provenance.mismatch).toBe(true);
    expect(provenance.message).toMatch(/pack you sent/);
  });

  it("reports all three ids it compared", async () => {
    const ours = scratch();
    const sent = await runPack(ours);
    const returned = await runPack(scratch());
    const { provenance } = await runUnpackMerge(returned, sent, ours);
    expect(provenance).toMatchObject({ returned: "proj_salt", base: "proj_salt", project: "proj_salt" });
    expect(provenance.mismatch).toBe(false);
    expect(provenance.message).toBeUndefined();   // quiet in the common case
  });

  it("cannot-say passes: a local project with no readable id is not a mismatch", async () => {
    // Undefined either side means "cannot say", and refusing on ignorance would
    // block a legitimate merge. Strip our own id and the check stands down.
    const ours = scratch();
    const sent = await runPack(ours);
    const theirs = scratch();
    const returned = await runPack(theirs);
    writeFileSync(join(ours, projFile),
      readFileSync(join(ours, projFile), "utf8").replace(/id:\s*"[^"]*"/, 'id: ""'));
    const { provenance } = await runUnpackMerge(returned, sent, ours);
    expect(provenance.project).toBeUndefined();
    expect(provenance.mismatch).toBe(false);
  });
});
