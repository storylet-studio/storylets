// What main takes from a renderer on trust, and now does not (the Storyletter
// review of 2026-10, item 27): an example name has to be one that shipped, a
// pack path has to be one main handed out, a number that reaches a shard has
// to be a number, and a deck address that cannot be a file is an error rather
// than a throw through IPC.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "./project.js";
import {
  addBackground, createCardOnCanvas, createHand, createZone, duplicateDeck, editBackground, moveCardsOnCanvas,
  moveSitesOnMap, setGroupSpatial, setZonePolygon, undo,
} from "./mutate.js";
import { HandedPaths, allFinite, shippedExample } from "./trust.js";
import { backgroundsOf } from "@storylet-studio/model";
import type { ProjectSession } from "./project.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

function scratch(example = "saltmarsh.storylets"): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-trust-")), example);
  cpSync(join(examples, example), dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";
const encBox = "b_enc";

describe("example:open takes only a shipped example's name", () => {
  it("knows the shipped ones", () => {
    expect(shippedExample("the-village.storylets")).toBe(true);
  });

  it("refuses a folder name the renderer made up, or a path out of examples/", () => {
    expect(shippedExample("saltmarsh.storylets")).toBe(false);   // in examples/, never shipped
    expect(shippedExample("../../secrets")).toBe(false);
    expect(shippedExample("")).toBe(false);
  });
});

describe("pack:openAt opens only a path main handed out", () => {
  it("accepts a path it was given and refuses any other", () => {
    const handed = new HandedPaths();
    handed.add("/Users/someone/Downloads/village.storyletpack");
    expect(handed.has("/Users/someone/Downloads/village.storyletpack")).toBe(true);
    expect(handed.has("/etc/passwd")).toBe(false);
    expect(handed.has("/Users/someone/Downloads/../Downloads/village.storyletpack")).toBe(true);
  });
});

describe("numbers that reach a shard", () => {
  it("allFinite says no to NaN, Infinity and anything not a number", () => {
    expect(allFinite(1, -2.5, 0)).toBe(true);
    expect(allFinite(1, Number.NaN)).toBe(false);
    expect(allFinite(Number.POSITIVE_INFINITY)).toBe(false);
    expect(allFinite("3" as unknown as number)).toBe(false);
  });

  it("a canvas placement that is not a number is refused, and nothing is written", async () => {
    const session = scratch();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    expect(await moveCardsOnCanvas(session, docks, [{ id: card.id, x: Number.NaN, y: 0 }])).toMatchObject({ error: expect.any(String) });
    expect(await createCardOnCanvas(session, docks, { x: Number.POSITIVE_INFINITY, y: 0 }, [])).toMatchObject({ error: expect.any(String) });
    expect(await undo(session)).toBeNull();
  });

  it("a zone, a pin or a picture with a non-number in it is refused", async () => {
    const session = scratch();
    await setGroupSpatial(session, encBox, "d_zone", true);
    const bad = [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 100, y: 100 }];
    expect(await createZone(session, encBox, "d_zone", bad)).toMatchObject({ error: expect.any(String) });
    expect(await setZonePolygon(session, encBox, "d_zone", "v_docks", bad)).toMatchObject({ error: expect.any(String) });
    expect(await moveSitesOnMap(session, encBox, "d_zone", [{ id: "h_docks", x: Number.POSITIVE_INFINITY, y: 0 }])).toMatchObject({ error: expect.any(String) });
    expect(await createHand(session, encBox, { x: Number.NaN, y: 1 })).toMatchObject({ error: expect.any(String) });

    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000400000002080600000" +
      "0b4b0e1590000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082", "hex");
    const place = { view: { width: 800, height: 400 }, scale: 1, at: { x: 100, y: 50 } };
    expect(await addBackground(session, encBox, "d_zone", { name: "plan.png", bytes: PNG }, { ...place, scale: Number.NaN }))
      .toMatchObject({ error: expect.any(String) });
    const added = await addBackground(session, encBox, "d_zone", { name: "plan.png", bytes: PNG }, place);
    if ("error" in added) throw new Error(added.error);
    const id = backgroundsOf(session.loaded.source!.map!.group)[0]!.id;
    const mapFile = join(session.loaded.dir, "map.storyletmap");
    const before = readFileSync(mapFile, "utf8");
    expect(await editBackground(session, encBox, "d_zone", id, { x: Number.NaN })).toMatchObject({ error: expect.any(String) });
    expect(readFileSync(mapFile, "utf8")).toBe(before);
  });
});

describe("a deck address that cannot be a file", () => {
  it("is an error from the mutation, not a throw through IPC", async () => {
    const session = scratch();
    const deck = session.loaded.source!.boxes[0]!.decks.find((d) => d.shard.deck.id === docks)!;
    deck.shard.deck.gameId = "../../../evil";
    let result: unknown;
    await expect((async () => { result = await duplicateDeck(session, docks); })()).resolves.toBeUndefined();
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(existsSync(join(session.loaded.dir, "..", "..", "..", "evil-copy.storyletdeck"))).toBe(false);
  });
});
