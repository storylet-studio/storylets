// The write path tested headlessly: edit a copy of the example project, save
// canonically, and confirm the change round-trips through disk + re-validate.
// (The load-bearing M1 contract - editor edits are the same path as hand
// edits, through the same validator.)

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject, projectSettings, toDto } from "./project.js";
import { projectHash } from "@storylet-studio/compiler";
import { runValidate } from "@storylet-studio/ops";
import {
  editBackground, restackBackground, removeBackground,
  addBackground,
  addCoverageDrivers, cardCatalogue, createBox, createCard, createDeck, createHand, createTagGroup, createTemplate,
  deleteBox, deleteCard, deleteDeck, deleteHand, deleteTagGroup, deleteTemplate, duplicateBox, duplicateCard,
  duplicateDeck, duplicateHand, duplicateTagGroup, duplicateTemplate,
  handDetail, moveBox, moveCard, moveDeck, moveHand, proposeDrivers, renameDeck,
  saveBox, saveCard, saveHand, saveProjectSettings, saveTagGroup, saveTemplate,
  moveCardsOnCanvas, layoutDeck,
  setGroupSpatial, setZonePolygon, moveSitesOnMap,
  tagGroupDetail, templateDetail, undo, restackZone,
  moveComment, postComment, setCanvasFurniture, setCommentResolved,
  declareProperty, deleteCommentMessage, repointTag,
} from "./mutate.js";
import { parseSource } from "@storylet-studio/compiler";
import type { ViewShard } from "@storylet-studio/model";
import { isSpatial, polygonOf, backgroundsOf, PLACE_GROUP } from "@storylet-studio/model";
import { commentsOf, markOf } from "@storylet-studio/model";
import type { Comment, TagGroup } from "@storylet-studio/model";
import type { ProjectSession } from "./project.js";
import type { Problem } from "../shared/api.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratchProject(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-mutate-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";   // the docks deck id in the example
const dockDeckFile = (session: ProjectSession): string =>
  join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck");

describe("arranging a canvas", () => {
  // The arrangement layer (design/graphical-views.md section 1.2). What matters
  // here is WHICH file moves: a designer tidying a canvas must not show up in a
  // content review, and must not be able to break content by dragging.
  const viewFile = (session: ProjectSession): string =>
    join(session.loaded.dir, "encounters", "view.storyletview");

  it("writes the box's sidecar and leaves the deck shard untouched", () => {
    const session = scratchProject();
    const before = readFileSync(dockDeckFile(session), "utf8");
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;

    const result = moveCardsOnCanvas(session, docks, [{ id: card.id, x: 120, y: 40 }]);
    expect("error" in result).toBe(false);
    expect(existsSync(viewFile(session))).toBe(true);
    // Canonical JSON5 leaves identifier-safe keys unquoted, so the id appears bare.
    expect(readFileSync(viewFile(session), "utf8")).toContain(card.id);
    expect(readFileSync(dockDeckFile(session), "utf8")).toBe(before);
  });

  it("round-trips the position back through the graph read", () => {
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    moveCardsOnCanvas(session, docks, [{ id: card.id, x: 120, y: 40 }]);
    // Re-read from the reloaded session, which is what the canvas asks on open.
    const box = session.loaded.source!.boxes.find((b) => b.decks.some((d) => d.shard.deck.id === docks))!;
    expect(box.view?.canvases?.[docks]?.cards?.[card.id]).toEqual({ x: 120, y: 40 });
  });

  it("is one undo step per drop", () => {
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    moveCardsOnCanvas(session, docks, [{ id: card.id, x: 120, y: 40 }]);
    moveCardsOnCanvas(session, docks, [{ id: card.id, x: 300, y: 200 }]);
    const positions = (): unknown => {
      const box = session.loaded.source!.boxes.find((b) => b.decks.some((d) => d.shard.deck.id === docks))!;
      return box.view?.canvases?.[docks]?.cards?.[card.id];
    };
    expect(positions()).toEqual({ x: 300, y: 200 });
    undo(session);
    // Back to the FIRST drop, not all the way to no arrangement: coalescing every
    // drag into one entry would make Cmd+Z discard an afternoon of tidying.
    expect(positions()).toEqual({ x: 120, y: 40 });
    undo(session);
    expect(positions()).toBeUndefined();
  });

  it("does not write when a card is dropped where it already was", () => {
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    moveCardsOnCanvas(session, docks, [{ id: card.id, x: 120, y: 40 }]);
    const after = readFileSync(viewFile(session), "utf8");
    const result = moveCardsOnCanvas(session, docks, [{ id: card.id, x: 120, y: 40 }]);
    expect("error" in result).toBe(false);
    expect(readFileSync(viewFile(session), "utf8")).toBe(after);
  });

  it("lays a deck out by dependency in one undo step", () => {
    const session = scratchProject();
    const deck = session.dto.boxes[0]!.decks[0]!;
    const ids = deck.cards.map((c) => c.id);
    const current = ids.map((id, i) => ({ id, x: i * 240, y: 0 }));

    const laid = layoutDeck(session, docks, ids, current, { width: 190, height: 76, gapX: 50, gapY: 40 });
    expect("error" in laid).toBe(false);
    if ("error" in laid) return;
    expect(laid.positions).toHaveLength(ids.length);
    // Written, and the deck shard untouched: arranging is never a content edit.
    expect(existsSync(viewFile(session))).toBe(true);

    // ONE step: undo returns the whole tidy, not one card at a time.
    const placed = (): unknown => {
      const box = session.loaded.source!.boxes.find((b) => b.decks.some((d) => d.shard.deck.id === docks))!;
      return box.view?.canvases?.[docks]?.cards;
    };
    expect(placed()).toBeDefined();
    undo(session);
    expect(placed()).toBeUndefined();
  });

  it("refuses to lay out nothing", () => {
    const session = scratchProject();
    expect(layoutDeck(session, docks, [], [], { width: 1, height: 1, gapX: 0, gapY: 0 }))
      .toEqual({ error: "nothing to lay out" });
  });

  it("refuses a deck it does not know", () => {
    const session = scratchProject();
    expect(moveCardsOnCanvas(session, "k_nope", [{ id: "c_x", x: 0, y: 0 }])).toEqual({ error: "unknown deck (id k_nope)" });
  });
});

describe("card mutations", () => {
  it("saves a title + condition edit canonically and round-trips it", () => {
    const session = scratchProject();
    const ambush = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    const result = saveCard(session, docks, ambush.id, {
      title: "Ambush at the crossing",
      condition: "@hand.danger >= 3",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const onDisk = readFileSync(dockDeckFile(session), "utf8");
    expect(onDisk).toContain('title: "Ambush at the crossing"');
    expect(onDisk).toContain('condition: "@hand.danger >= 3"');
    // Canonical form is preserved (trailing commas, sorted keys).
    expect(onDisk).toContain('  schema: "storylets/deck@0",');
    expect(onDisk.trimEnd().endsWith("}")).toBe(true);

    // A fresh open sees the edit (files are the truth).
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const card = reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ambush.id)!;
    expect(card.title).toBe("Ambush at the crossing");
    expect(card.condition).toBe("@hand.danger >= 3");
  });

  it("coerces priority and redraw from typed text", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { priority: "@story.reputation + 1", redraw: "3" });
    const onDisk = readFileSync(dockDeckFile(session), "utf8");
    expect(onDisk).toContain('priority: "@story.reputation + 1"');   // expression -> string
    expect(onDisk).toContain("redraw: 3");                            // number literal
  });

  it("toggles a tag by resolving tag gameIds to ids", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { tags: [{ group: "area", values: ["docks", "market"] }] });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const card = reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ratJob.id)!;
    expect(card.tags).toEqual([{ group: "area", values: ["docks", "market"] }]);
  });

  it("homes a card to a hand: home values are hand gameIds, stored as hand ids", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, {
      tags: [{ group: "area", values: ["docks"] }, { group: PLACE_GROUP, values: ["docks-street"] }],
    });
    const onDisk = readFileSync(dockDeckFile(session), "utf8");
    expect(onDisk).toContain('"h_docks"');   // stored as the hand's id
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const card = reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ratJob.id)!;
    expect(card.tags.find((t) => t.group === PLACE_GROUP)!.values).toEqual(["docks-street"]);
  });

  it("saves copies when 2+, and clears it back to the default of 1", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { copies: "3" });
    expect(readFileSync(dockDeckFile(session), "utf8")).toContain("copies: 3");
    let reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ratJob.id)!.copies).toBe("3");

    saveCard(session, docks, ratJob.id, { copies: "1" });
    expect(readFileSync(dockDeckFile(session), "utf8")).not.toContain("copies:");
    reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ratJob.id)!.copies).toBe("");
  });

  it("creates a card with a unique gameId and a default outcome, then deletes it", () => {
    const session = scratchProject();
    const created = createCard(session, docks);
    expect("error" in created).toBe(false);
    if ("error" in created) return;
    const newCard = created.result.project.boxes[0]!.decks[0]!.cards.find((c) => c.id === created.cardId)!;
    expect(newCard.gameId).toBe("new-card");
    expect(newCard.outcomes).toHaveLength(1);

    // A second create dedupes the gameId.
    const second = createCard(session, docks);
    if ("error" in second) return;
    const secondCard = second.result.project.boxes[0]!.decks[0]!.cards.find((c) => c.id === second.cardId)!;
    expect(secondCard.gameId).toBe("new-card-2");

    const afterDelete = deleteCard(session, docks, created.cardId);
    if ("error" in afterDelete) return;
    expect(afterDelete.project.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(false);
  });

  it("saving an outcome's gate and changes round-trips them", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    const accepted = ratJob.outcomes[0]!;
    saveCard(session, docks, ratJob.id, {
      outcomes: [{
        id: accepted.id, gameId: "accepted", title: "Take it",
        gate: "@story.reputation >= 0",
        changes: [{ target: "@story.reputation", value: "@story.reputation + 1" }],
      }],
    });
    const onDisk = readFileSync(dockDeckFile(session), "utf8");
    expect(onDisk).toContain('condition: "@story.reputation >= 0"');
    expect(onDisk).toContain('"@story.reputation": "@story.reputation + 1"');
  });

  it("duplicates a card (fresh ids, deduped gameId, inserted after the original)", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    const before = session.dto.boxes[0]!.decks[0]!.cards.length;
    const dup = duplicateCard(session, docks, ratJob.id);
    expect("error" in dup).toBe(false);
    if ("error" in dup) return;
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const cards = reopened.session.dto.boxes[0]!.decks[0]!.cards;
    expect(cards.length).toBe(before + 1);
    const clone = cards.find((c) => c.id === dup.cardId)!;
    expect(clone.id).not.toBe(ratJob.id);
    expect(clone.gameId).toBe("rat-job-copy");
    // Outcomes are cloned with fresh ids.
    const origOutcomeIds = new Set(cards.find((c) => c.id === ratJob.id)!.outcomes.map((o) => o.id));
    expect(clone.outcomes.every((o) => !origOutcomeIds.has(o.id))).toBe(true);
  });

  it("moves a card before a target and the reorder persists", () => {
    const session = scratchProject();
    const cards0 = session.dto.boxes[0]!.decks[0]!.cards;
    const ambush = cards0.find((c) => c.gameId === "ambush-at-the-ford")!;
    const ratJob = cards0.find((c) => c.gameId === "rat-job")!;
    expect(cards0.findIndex((c) => c.id === ambush.id)).toBeLessThan(cards0.findIndex((c) => c.id === ratJob.id));
    const r = moveCard(session, docks, ratJob.id, ambush.id, true);   // rat-job before ambush
    expect("error" in r).toBe(false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    // Display order (the DTO, sorted by `order`) reflects the move.
    const order = reopened.session.dto.boxes[0]!.decks[0]!.cards.map((c) => c.gameId);
    expect(order.indexOf("rat-job")).toBeLessThan(order.indexOf("ambush-at-the-ford"));
    // Storage stays id-sorted (Reboot 7.4); only the moved card gains `order`.
    const onDisk = readFileSync(dockDeckFile(session), "utf8");
    const idOrder = [...onDisk.matchAll(/^      id: "([^"]+)"/gm)].map((m) => m[1]);
    expect(idOrder).toEqual([...idOrder].sort());
    expect(onDisk).toContain("order: -1");
  });

  it("reads and saves project settings (name + a story property) round-trip", () => {
    const session = scratchProject();
    const before = projectSettings(session);
    expect(before.name).toBe("Saltmarsh");
    expect(before.story.some((p) => p.name === "reputation")).toBe(true);
    const next = {
      ...before, name: "Saltmarsh Revised",
      story: [...before.story, { name: "morale", type: "number", default: "5" }],
    };
    const r = saveProjectSettings(session, next);
    expect("error" in r).toBe(false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const after = projectSettings(reopened.session);
    expect(after.name).toBe("Saltmarsh Revised");
    const morale = after.story.find((p) => p.name === "morale")!;
    expect(morale).toMatchObject({ type: "number", default: "5" });
  });

  it("round-trips a property's purpose, and an emptied one deletes", () => {
    // The purpose is the pill's hover tip (expr-editor's propertyTip), so it
    // has to survive the save; and a cleared field must DELETE the key, not
    // store "" - the shard says nothing rather than saying nothing verbosely.
    const session = scratchProject();
    const before = projectSettings(session);
    const next = {
      ...before,
      story: [...before.story, { name: "morale", type: "number", default: "5", purpose: "how the crew feels" }],
    };
    expect("error" in saveProjectSettings(session, next)).toBe(false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const written = projectSettings(reopened.session);
    expect(written.story.find((p) => p.name === "morale")).toMatchObject({ purpose: "how the crew feels" });

    const cleared = {
      ...written,
      story: written.story.map((p) => (p.name === "morale" ? { ...p, purpose: "  " } : p)),
    };
    expect("error" in saveProjectSettings(reopened.session, cleared)).toBe(false);
    const again = openProject(session.loaded.dir);
    if ("error" in again) throw new Error(again.error);
    const decl = again.session.loaded.source!.project.story.properties.find((p) => p.name === "morale")!;
    expect("purpose" in decl).toBe(false);
  });

  it("edits coverage drivers beside the world properties, and prunes the inert ones", () => {
    const session = scratchProject();
    const before = projectSettings(session);
    const next = {
      ...before,
      drivers: [
        { ref: "@world.raining", kind: "recurring" as const, cadence: "often" as const, values: [true, false] },
        { ref: "@world.danger", kind: "initial" as const, values: [0, 50] },
        // Inert rows: no property name, and a named ref with an empty pool.
        // Neither can drive anything, so neither reaches the shard.
        { ref: "@world.", kind: "recurring" as const, values: [1] },
        { ref: "@world.unused", kind: "recurring" as const, values: [] },
      ],
    };
    expect("error" in saveProjectSettings(session, next)).toBe(false);

    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const written = reopened.session.loaded.source!.project.coverage!.drivers!;
    expect(Object.keys(written).sort()).toEqual(["@world.danger", "@world.raining"]);
    expect(written["@world.raining"]).toEqual({ kind: "recurring", cadence: "often", values: [true, false] });
    // An initial driver carries no cadence: it fires once, so there is
    // nothing for a cadence to mean.
    expect(written["@world.danger"]).toEqual({ kind: "initial", values: [0, 50] });

    // And they come back out in the same editable shape, ref-sorted.
    const after = projectSettings(reopened.session);
    expect(after.drivers.map((d) => d.ref)).toEqual(["@world.danger", "@world.raining"]);
  });

  it("clears the drivers when the last row is removed", () => {
    const session = scratchProject();
    const seeded = { ...projectSettings(session), drivers: [{ ref: "@world.raining", kind: "recurring" as const, cadence: "sometimes" as const, values: [true] }] };
    saveProjectSettings(session, seeded);
    const mid = openProject(session.loaded.dir);
    if ("error" in mid) throw new Error(mid.error);
    expect(projectSettings(mid.session).drivers).toHaveLength(1);

    saveProjectSettings(mid.session, { ...projectSettings(mid.session), drivers: [] });
    const after = openProject(mid.session.loaded.dir);
    if ("error" in after) throw new Error(after.error);
    expect(after.session.loaded.source!.project.coverage?.drivers).toBeUndefined();
    expect(projectSettings(after.session).drivers).toEqual([]);
  });

  it("proposes drivers from the cards without writing them", () => {
    const session = scratchProject();
    // Gate a card on a declared @world property nothing writes: exactly the
    // case a driver exists for.
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { condition: "@world.danger >= 2" });

    const proposed = proposeDrivers(session);
    const danger = proposed.find((d) => d.ref === "@world.danger");
    expect(danger).toBeDefined();
    // The boundary and its neighbours, so the comparison is exercised both ways.
    expect(danger!.values).toEqual([1, 2, 3]);

    // The shard is untouched: the dialog saves the proposal, the proposal does not.
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.project.coverage?.drivers).toBeUndefined();
  });

  it("renames a card gameId (slugged, in-shard)", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { gameId: "Dock Work" });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === ratJob.id)!.gameId).toBe("dock-work");
  });

  it("creates a deck (a new shard file), then deletes it when empty", () => {
    const session = scratchProject();
    const boxId = session.dto.boxes[0]!.id;
    const created = createDeck(session, boxId);
    expect("error" in created).toBe(false);
    if ("error" in created) return;
    const newDeck = created.result.project.boxes[0]!.decks.find((d) => d.id === created.deckId)!;
    expect(newDeck.gameId).toBe("new-deck");
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "new-deck.storyletdeck"))).toBe(true);

    const deleted = deleteDeck(session, created.deckId);
    if ("error" in deleted) return;
    expect(deleted.project.boxes[0]!.decks.some((d) => d.id === created.deckId)).toBe(false);
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "new-deck.storyletdeck"))).toBe(false);
  });

  it("refuses to delete a non-empty deck", () => {
    const session = scratchProject();
    const result = deleteDeck(session, docks);
    expect(result).toEqual({ error: expect.stringContaining("cards first") });
  });

  it("saves the deck gate and @deck properties and round-trips them", () => {
    const session = scratchProject();
    const r = renameDeck(session, docks, {
      gate: "@story.reputation >= 0",
      properties: [{ name: "heat", type: "number", default: "0" }],
    });
    expect("error" in r).toBe(false);
    const opened = openProject(session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    const deck = opened.session.dto.boxes[0]!.decks.find((d) => d.id === docks)!;
    expect(deck.gate).toBe("@story.reputation >= 0");
    expect(deck.properties).toEqual([{ name: "heat", type: "number", default: "0" }]);
    // ...and the declared @deck property reaches the expression catalogue.
    const cat = cardCatalogue(opened.session, docks);
    expect(cat.some((p) => p.scope === "deck" && p.name === "heat")).toBe(true);
  });

  it("renames a deck and moves its file to match the gameId", () => {
    const session = scratchProject();
    const result = renameDeck(session, docks, { title: "The Docks", gameId: "harbour" });
    expect("error" in result).toBe(false);
    const withPurpose = renameDeck(session, docks, { purpose: "Harbour-side beats." });
    expect("error" in withPurpose).toBe(false);
    expect("error" in result).toBe(false);
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "harbour.storyletdeck"))).toBe(true);
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck"))).toBe(false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const deck = reopened.session.dto.boxes[0]!.decks.find((d) => d.id === docks)!;
    expect(deck.title).toBe("The Docks");
    expect(deck.gameId).toBe("harbour");
  });

  it("adds coverage drivers for a host-gated card and writes them to the project shard", () => {
    const session = scratchProject();
    // Add a card gated on a new @world property nothing writes.
    const projFile = join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck");
    const deck = readFileSync(projFile, "utf8").replace(
      "  cards: [\n",
      '  cards: [\n    { condition: "@world.raining", gameId: "storm", id: "c_storm01", outcomes: [], priority: 0, redraw: "always" },\n',
    );
    writeFileSync(projFile, deck);
    const worldFile = join(session.loaded.dir, "saltmarsh.storyletproj");
    const proj = readFileSync(worldFile, "utf8").replace(
      "    properties: [\n      {\n        default: 0,\n        name: \"danger\",",
      "    properties: [\n      { default: false, name: \"raining\", type: \"boolean\" },\n      {\n        default: 0,\n        name: \"danger\",",
    );
    writeFileSync(worldFile, proj);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);

    const result = addCoverageDrivers(reopened.session);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.added).toContain("@world.raining");
    // Written to the project shard, and it re-loads with the driver.
    const on = openProject(reopened.session.loaded.dir);
    if ("error" in on) throw new Error(on.error);
    expect(on.session.loaded.source!.project.coverage?.drivers?.["@world.raining"]).toBeDefined();
  });

  it("builds the expr-editor catalogue across the five scopes", () => {
    const session = scratchProject();
    const cat = cardCatalogue(session, docks);
    expect(cat.find((p) => p.scope === "story" && p.name === "reputation")).toBeDefined();
    expect(cat.find((p) => p.scope === "world" && p.name === "danger")).toBeDefined();
    // @hand: the docks tag's danger property is offered for authoring assist.
    expect(cat.find((p) => p.scope === "hand" && p.name === "danger")).toBeDefined();
    // ...and each tag group's name reads as the chosen/criteria tag, typed as
    // an enum over that group's tags so the picker offers them and a misspelt
    // tag name is caught (the same shape the compiler infers for @hand).
    expect(cat.find((p) => p.scope === "hand" && p.name === "area"))
      .toMatchObject({ type: "enum", enumValues: ["docks", "market"] });
  });

  // expr-editor 0.11.0 made qualities authorable: the picker offers them, the
  // operator step gives them the full comparison set, and the value step lists
  // their stages IN LADDER ORDER. All of that needs the ladder, which reaches
  // the editor through the catalogue, so a quality that arrives without its
  // stages is a property a writer can pick and then not finish a clause on.
  // A tag group declares properties every tag has (design/hand-typing.md step
  // B); a tag carries only its own starting value. The editor has to be able
  // to say both, or the DRY shape is source-only and Storyletter can't reach it.
  it("declares a property on a group and a starting value on one tag", () => {
    const session = scratchProject();
    const g = tagGroupDetail(session, encBox, "d_zone");
    if (!g) throw new Error("the fixture needs its zone group");
    const r = saveTagGroup(session, encBox, "d_zone", {
      properties: [{ name: "haunting", type: "number", default: "0" }],
      values: g.values.map((v) => (v.gameId === "market" ? { ...v, values: { haunting: "3" } } : v)),
    });
    expect("error" in r).toBe(false);

    const opened = openProject(session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    const again = tagGroupDetail(opened.session, encBox, "d_zone")!;
    expect(again.properties).toEqual([{ name: "haunting", type: "number", default: "0" }]);
    expect(again.values.find((v) => v.gameId === "market")?.values).toEqual({ haunting: "3" });
    expect(again.values.find((v) => v.gameId === "docks")?.values ?? {}).toEqual({});
  });

  it("carries a quality's ladder into the catalogue, in order", () => {
    const session = scratchProject();
    const r = renameDeck(session, docks, {
      properties: [{ name: "debt", type: "quality", default: "quiet", stages: ["quiet", "troubled", "confronted"] }],
    });
    expect("error" in r).toBe(false);
    const opened = openProject(session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    const entry = cardCatalogue(opened.session, docks).find((p) => p.scope === "deck" && p.name === "debt");
    expect(entry).toMatchObject({ type: "quality", stages: ["quiet", "troubled", "confronted"] });
  });
});

const encBox = "b_enc";

describe("project settings", () => {
  it("round-trips the unread-writes warning switch, absent when off", () => {
    const session = scratchProject();
    const before = projectSettings(session);
    expect(before.warnUnreadWrites).toBe(false);
    const r = saveProjectSettings(session, { ...before, warnUnreadWrites: true });
    expect("error" in r).toBe(false);
    const opened = openProject(session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    expect(projectSettings(opened.session).warnUnreadWrites).toBe(true);
    // ...and turning it back off removes the key entirely, like export.map.
    saveProjectSettings(opened.session, { ...projectSettings(opened.session), warnUnreadWrites: false });
    const shard = readFileSync(join(opened.session.loaded.dir, opened.session.loaded.source!.path), "utf8");
    expect(shard).not.toContain("validation");
  });
});

describe("box mutations", () => {
  it("saves the box title and purpose and round-trips them", () => {
    const session = scratchProject();
    const r = saveBox(session, encBox, { title: "Street encounters", purpose: "Random beats out on the streets." });
    expect("error" in r).toBe(false);
    const box = openProject(session.loaded.dir);
    if ("error" in box) throw new Error(box.error);
    const b = box.session.dto.boxes.find((x) => x.id === encBox)!;
    expect(b.title).toBe("Street encounters");
    expect(b.purpose).toBe("Random beats out on the streets.");
  });

  it("edits the box card fields and round-trips them", () => {
    const session = scratchProject();
    const result = saveBox(session, encBox, {
      title: "Street encounters",
      fields: [
        { name: "patter-scene", type: "string", default: "" },
        { name: "weight", type: "number", default: "2" },
      ],
    });
    expect("error" in result).toBe(false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const box = reopened.session.loaded.source!.boxes[0]!.box.box;
    expect(box.title).toBe("Street encounters");
    expect(box.fields).toEqual([
      { name: "patter-scene", type: "string", default: "" },
      { name: "weight", type: "number", default: 2 },
    ]);
  });

  it("edits the ranking specificity flag", () => {
    const session = scratchProject();
    saveBox(session, encBox, { ranking: { specificity: false } });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.boxes[0]!.box.box.ranking?.specificity).toBe(false);
  });

  it("creates a blank box: empty shards, nothing scaffolded", () => {
    const session = scratchProject();
    const created = createBox(session);
    if ("error" in created) throw new Error(created.error);
    const box = created.result.project.boxes.find((b) => b.id === created.boxId)!;
    expect(box.decks).toEqual([]);
    expect(box.templates).toEqual([]);
    expect(box.tagGroups).toEqual([]);
    expect(box.hands).toEqual([]);
  });

  it("duplicates a whole box: fresh ids throughout, cross-references remapped, valid on landing", () => {
    const session = scratchProject();
    const created = duplicateBox(session, encBox);
    if ("error" in created) throw new Error(created.error);
    expect(created.result.problems.filter((p) => p.severity === "error")).toEqual([]);
    const clone = created.result.project.boxes.find((b) => b.id === created.boxId)!;
    expect(clone.gameId).toBe("encounters-copy");
    // Structure carried whole: decks, cards, tags, templates, hands.
    expect(clone.decks.map((d) => d.gameId).sort()).toEqual(["docks", "market"]);
    expect(clone.tagGroups.map((g) => g.gameId)).toEqual(["area"]);
    // Hand gameIds are API (project-wide unique): the clone's hands rename.
    expect(clone.hands[0]).toMatchObject({ gameId: "docks-street-copy", template: "street-hands" });
    // Fresh ids everywhere; references land on the CLONE's entities (the
    // remapped chosen tag resolves inside the clone, names intact).
    const source = created.result.project.boxes.find((b) => b.id === encBox)!;
    expect(clone.id).not.toBe(encBox);
    expect(clone.hands[0]!.id).not.toBe(source.hands[0]!.id);
    const detail = handDetail(session, created.boxId, clone.hands[0]!.id)!;
    expect(detail.chosen).toEqual([{ group: "area", value: "docks", values: ["docks", "market"] }]);
    // The clone's cards are tagged with the CLONE's tag ids (round-trip by
    // name), and their gameIds dedupe too (the play log speaks them).
    const ambush = clone.decks.find((d) => d.gameId === "docks")!.cards.find((c) => c.gameId === "ambush-at-the-ford-copy")!;
    expect(ambush.tags).toEqual([{ group: "area", values: ["docks"] }]);
  });

  it("deletes a whole box (every shard), and undo restores it", () => {
    const session = scratchProject();
    const result = deleteBox(session, encBox);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.project.boxes.some((b) => b.id === encBox)).toBe(false);
    expect(existsSync(join(session.loaded.dir, "encounters", "box.storyletbox"))).toBe(false);
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck"))).toBe(false);
    const undone = undo(session);
    expect(undone).not.toBeNull();
    expect(undone!.project.boxes.some((b) => b.id === encBox)).toBe(true);
    expect(existsSync(join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck"))).toBe(true);
  });

  it("reorders boxes, decks and hands with the cards' sparse-order rule", () => {
    const session = scratchProject();
    // Boxes: a fresh box lands after encounters (creation order); move it first.
    const created = createBox(session);
    if ("error" in created) throw new Error(created.error);
    expect(created.result.project.boxes.map((b) => b.id)).toEqual([encBox, created.boxId]);
    const movedBox = moveBox(session, created.boxId, encBox, true);
    expect("error" in movedBox).toBe(false);
    // Decks: market before docks.
    moveDeck(session, "k_market", "k_docks", true);
    // Hands: a new hand moved before the docks hand.
    const hand = createHand(session, encBox);
    if ("error" in hand) throw new Error(hand.error);
    moveHand(session, encBox, hand.handId, "h_docks", true);
    // Every reorder persists through a fresh open (order rides the shards).
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.dto.boxes.map((b) => b.id)).toEqual([created.boxId, encBox]);
    const enc = reopened.session.dto.boxes.find((b) => b.id === encBox)!;
    expect(enc.decks.map((d) => d.gameId)).toEqual(["market", "docks"]);
    expect(enc.hands.map((h) => h.id)).toEqual([hand.handId, "h_docks"]);
  });

  it("creates a box from the RPG kit: the narrated starter, valid on landing", () => {
    const session = scratchProject();
    const created = createBox(session, "rpg");
    if ("error" in created) throw new Error(created.error);
    // Scaffold, not framework: the kit lands with no validation errors.
    expect(created.result.problems.filter((p) => p.severity === "error")).toEqual([]);
    const box = created.result.project.boxes.find((b) => b.id === created.boxId)!;
    // No card template here, and that is the content pass rather than a loss:
    // the kit used to declare a `scene` field that no sample card filled and
    // nothing explained, which teaches that the concept exists and not what it
    // is for. The barks kit taught it properly and has been withdrawn (barks
    // are Patter's, 2026-08-29), so NO kit teaches the card template now: see
    // the state-of-play row, which carries that as the open consequence.
    expect(box.fields).toEqual([]);
    // What this kit gained instead: a property, and an outcome that writes it.
    // Every kit's outcomes were "Continue" with no changes, so an author could
    // work through all three and never learn what playing a card does.
    expect(box.properties.map((p) => p.name)).toEqual(["tension"]);
    const wager = box.decks[0]!.cards[0]!;
    expect(wager.outcomes.map((o) => o.title)).toEqual(["Take the bet", "Walk away"]);
    expect(box.tagGroups.map((g) => g.gameId)).toEqual(["area"]);
    expect(box.tagGroups[0]!.values).toEqual(["tavern", "market"]);
    expect(box.templates.map((t) => t.gameId)).toEqual(["encounters-at"]);
    expect(box.hands).toHaveLength(1);
    expect(box.hands[0]!.template).toBe("encounters-at");
    expect(box.decks).toHaveLength(1);
    expect(box.decks[0]!.cards).toHaveLength(1);
    expect(box.decks[0]!.cards[0]!.tags).toEqual([{ group: "area", values: ["tavern"] }]);
  });

  it("the dialogue kit lands valid, teaching its chapter", () => {
    const session = scratchProject();
    const dialogue = createBox(session, "dialogue");
    if ("error" in dialogue) throw new Error(dialogue.error);
    expect(dialogue.result.problems.filter((p) => p.severity === "error")).toEqual([]);
    const d = dialogue.result.project.boxes.find((b) => b.id === dialogue.boxId)!;
    expect(d.hands).toHaveLength(2);   // one hand per NPC
    // The shared rumour is tagged with BOTH NPCs (one copy: exclusivity).
    const rumour = d.decks[0]!.cards.find((c) => c.gameId === "a-rumour-about-the-well")!;
    expect(rumour.tags).toEqual([{ group: "npc", values: ["gareth", "mira"] }]);

    // And the opt-out from exclusivity, which the dialogue picker's blurb had
    // been promising while the kit had no `copies` in it at all.
    const roads = d.decks[0]!.cards.find((c) => c.gameId === "a-complaint-about-the-roads")!;
    expect(roads.copies).toBe("2");   // the DTO carries scalars as editable strings
  });

  it("applying the same kit twice dedupes its hand and card names (they are API)", () => {
    const session = scratchProject();
    const first = createBox(session, "rpg");
    if ("error" in first) throw new Error(first.error);
    const second = createBox(session, "rpg");
    if ("error" in second) throw new Error(second.error);
    expect(second.result.problems.filter((p) => p.severity === "error")).toEqual([]);
    const clone = second.result.project.boxes.find((b) => b.id === second.boxId)!;
    expect(clone.hands[0]!.gameId).toBe("tavern-encounters-2");
    expect(clone.decks[0]!.cards[0]!.gameId).toBe("a-strangers-wager-2");
  });
});

describe("duplicate parity (surface review F5)", () => {
  it("duplicates a deck: new shard file, fresh deck/card/outcome ids, deduped gameId", () => {
    const session = scratchProject();
    const src = session.dto.boxes[0]!.decks.find((d) => d.id === docks)!;
    const created = duplicateDeck(session, docks);
    if ("error" in created) throw new Error(created.error);
    const clone = created.result.project.boxes[0]!.decks.find((d) => d.id === created.deckId)!;
    expect(clone.id).not.toBe(docks);
    expect(clone.gameId).toBe(`${src.gameId}-copy`);
    expect(clone.cards.length).toBe(src.cards.length);
    const srcCardIds = new Set(src.cards.map((c) => c.id));
    expect(clone.cards.every((c) => !srcCardIds.has(c.id))).toBe(true);
  });

  it("duplicates a hand template with a deduped gameId and the same contract", () => {
    const session = scratchProject();
    const created = duplicateTemplate(session, encBox, "t_street");
    if ("error" in created) throw new Error(created.error);
    const detail = templateDetail(session, encBox, created.templateId)!;
    expect(detail.gameId).toBe("street-hands-copy");
    expect(detail.bindings).toEqual([{ group: "area", hole: true }]);
    expect(detail.slots).toBe("3");
  });

  it("duplicates a hand with its template, chosen tags and slots", () => {
    const session = scratchProject();
    const created = duplicateHand(session, encBox, "h_docks");
    if ("error" in created) throw new Error(created.error);
    const detail = handDetail(session, encBox, created.handId)!;
    expect(detail.gameId).toBe("docks-street-copy");
    expect(detail.template).toBe("street-hands");
    expect(detail.chosen).toEqual([{ group: "area", value: "docks", values: ["docks", "market"] }]);
    expect(detail.slots).toBe("2");
  });

  it("duplicates a tag group with fresh tag ids", () => {
    const session = scratchProject();
    const src = tagGroupDetail(session, encBox, "d_zone")!;
    const created = duplicateTagGroup(session, encBox, "d_zone");
    if ("error" in created) throw new Error(created.error);
    const clone = tagGroupDetail(session, encBox, created.groupId)!;
    expect(clone.gameId).toBe("area-copy");
    expect(clone.values.map((v) => v.gameId)).toEqual(src.values.map((v) => v.gameId));
    const srcIds = new Set(src.values.map((v) => v.id));
    expect(clone.values.every((v) => v.id !== undefined && !srcIds.has(v.id))).toBe(true);
  });
});

describe("hands", () => {
  it("reads a hand's detail: its template, one chosen row per hole, and slots", () => {
    const session = scratchProject();
    const detail = handDetail(session, encBox, "h_docks");
    expect(detail).not.toBeNull();
    expect(detail!.gameId).toBe("docks-street");
    expect(detail!.template).toBe("street-hands");
    expect(detail!.rule).toBeUndefined();
    // street-hands has one hole (area), filled here with docks.
    expect(detail!.chosen).toEqual([{ group: "area", value: "docks", values: ["docks", "market"] }]);
    expect(detail!.slots).toBe("2");
  });

  it("offers the box's templates with their holes, for the picker", () => {
    const session = scratchProject();
    const detail = handDetail(session, encBox, "h_docks")!;
    expect(detail.templates).toEqual([{ gameId: "street-hands", chooses: ["area"], slots: "3" }]);
    expect(detail.groups).toEqual([{ gameId: "area", values: ["docks", "market"] }]);
  });

  it("saves chosen tags, a slots override and @hand properties, and round-trips them", () => {
    const session = scratchProject();
    const saved = saveHand(session, encBox, "h_docks", {
      title: "The docks",
      chosen: [{ group: "area", value: "market" }],
      slots: "4",
      properties: [{ name: "danger", type: "number", default: "3" }],
    });
    expect("error" in saved).toBe(false);
    const detail = handDetail(session, encBox, "h_docks")!;
    expect(detail.title).toBe("The docks");
    expect(detail.chosen).toEqual([{ group: "area", value: "market", values: ["docks", "market"] }]);
    expect(detail.slots).toBe("4");
    expect(detail.properties).toEqual([{ name: "danger", type: "number", default: "3" }]);
    // The stored form holds ids, not names.
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const hand = reopened.session.loaded.source!.boxes[0]!.hands.hands.find((h) => h.id === "h_docks")!;
    expect(hand.chosen).toEqual({ d_zone: "v_market" });
  });

  it("blank slots follow the template's own slot count", () => {
    const session = scratchProject();
    saveHand(session, encBox, "h_docks", { slots: "" });
    expect(handDetail(session, encBox, "h_docks")!.slots).toBe("");
  });

  it("converts a template instance to standalone (an empty rule) and back", () => {
    const session = scratchProject();
    saveHand(session, encBox, "h_docks", { template: "" });
    let detail = handDetail(session, encBox, "h_docks")!;
    expect(detail.template).toBeUndefined();
    expect(detail.chosen).toEqual([]);
    expect(detail.rule).toEqual({ bindings: [{ group: "area" }], slots: "unbounded" });

    // The standalone rule takes bindings, a condition and its own slots.
    saveHand(session, encBox, "h_docks", {
      rule: { bindings: [{ group: "area", value: "docks" }], condition: "@story.reputation > 1", slots: "2" },
    });
    detail = handDetail(session, encBox, "h_docks")!;
    expect(detail.rule).toEqual({
      bindings: [{ group: "area", value: "docks" }],
      condition: "@story.reputation > 1",
      slots: "2",
    });

    // Back to the template: the rule is dropped (exactly one of template / rule).
    saveHand(session, encBox, "h_docks", { template: "street-hands" });
    detail = handDetail(session, encBox, "h_docks")!;
    expect(detail.template).toBe("street-hands");
    expect(detail.rule).toBeUndefined();
  });

  it("hand properties reach the @hand catalogue", () => {
    const session = scratchProject();
    saveHand(session, encBox, "h_docks", { properties: [{ name: "crowded", type: "boolean", default: "true" }] });
    const cat = cardCatalogue(session, "k_docks");
    expect(cat.some((p) => p.scope === "hand" && p.name === "crowded")).toBe(true);
  });

  it("GROUP-declared properties reach the @hand catalogue, purpose and all", () => {
    // The patrolled pattern (Port Meridian): declared ONCE on the group, set
    // per tag, flattened onto every tag by the compiler - so @hand.patrolled
    // is a legal read. The catalogue fed only per-TAG declarations, so the
    // expression editor called the reference unknown and painted an error the
    // problems bar rightly refused to echo (the author's report, 2026-08-28).
    const session = scratchProject();
    const g = tagGroupDetail(session, encBox, "d_zone");
    if (!g) throw new Error("the fixture needs its zone group");
    saveTagGroup(session, encBox, "d_zone", {
      properties: [{ name: "patrolled", type: "boolean", default: "false", purpose: "Where the watch walks." }],
      values: g.values,
    });
    const cat = cardCatalogue(session, "k_docks");
    const entry = cat.find((p) => p.scope === "hand" && p.name === "patrolled");
    expect(entry?.type).toBe("boolean");
    expect(entry?.purpose).toBe("Where the watch walks.");
  });

  it("creates a hand (standalone, an empty rule) and deletes it", () => {
    const session = scratchProject();
    const created = createHand(session, encBox);
    if ("error" in created) throw new Error(created.error);
    const detail = handDetail(session, encBox, created.handId)!;
    expect(detail.template).toBeUndefined();
    expect(detail.rule).toEqual({ bindings: [{ group: "area" }], slots: "unbounded" });
    const deleted = deleteHand(session, encBox, created.handId);
    expect("error" in deleted).toBe(false);
    expect(handDetail(session, encBox, created.handId)).toBeNull();
  });
});

describe("hand template mutations", () => {
  it("reads a template's detail: one binding row per tag group, holes marked", () => {
    const session = scratchProject();
    const detail = templateDetail(session, encBox, "t_street");
    expect(detail).not.toBeNull();
    expect(detail!.gameId).toBe("street-hands");
    expect(detail!.bindings).toEqual([{ group: "area", hole: true }]);
    expect(detail!.slots).toBe("3");
    expect(detail!.instances).toEqual(["Docks street"]);
  });

  it("saves the template's shared condition and round-trips it", () => {
    const session = scratchProject();
    const r = saveTemplate(session, encBox, "t_street", { condition: "@story.reputation > 1" });
    expect("error" in r).toBe(false);
    expect(templateDetail(session, encBox, "t_street")!.condition).toBe("@story.reputation > 1");
    saveTemplate(session, encBox, "t_street", { condition: "" });
    expect(templateDetail(session, encBox, "t_street")!.condition).toBeUndefined();
  });

  it("saves a template edit (purpose, slots, fixed binding) and round-trips it", () => {
    const session = scratchProject();
    saveTemplate(session, encBox, "t_street", {
      purpose: "What happens here?",
      slots: "2",
      bindings: [{ group: "area", value: "market" }],
    });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const template = reopened.session.loaded.source!.boxes[0]!.hands.templates.find((t) => t.id === "t_street")!;
    expect(template.purpose).toBe("What happens here?");
    expect(template.slots).toBe(2);
    expect(template.bindings).toEqual({ d_zone: "v_market" });
    expect(template.chooses).toBeUndefined();
  });

  it("closing a hole drops the stale chosen entries from instances", () => {
    const session = scratchProject();
    // area stops being a hole; h_docks chose docks for it, which must go.
    saveTemplate(session, encBox, "t_street", { bindings: [{ group: "area", value: "market" }] });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const hand = reopened.session.loaded.source!.boxes[0]!.hands.hands.find((h) => h.id === "h_docks")!;
    expect(hand.chosen).toBeUndefined();
  });

  it("creates a template with a unique gameId, then deletes it", () => {
    const session = scratchProject();
    const created = createTemplate(session, encBox);
    expect("error" in created).toBe(false);
    if ("error" in created) return;
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.boxes[0]!.hands.templates.find((t) => t.id === created.templateId)!.gameId)
      .toBe("new-template");
    const deleted = deleteTemplate(session, encBox, created.templateId);
    expect("error" in deleted).toBe(false);
  });

  it("refuses to delete a template a hand still instances", () => {
    const session = scratchProject();
    const result = deleteTemplate(session, encBox, "t_street");
    expect(result).toEqual({ error: expect.stringContaining("instances") });
  });
});

describe("the map (spatial tag groups)", () => {
  // #55 slice 1 and 2. What matters here is which FILE moves and what survives:
  // geometry lives in the tags shard, sites in the arrangement sidecar, and an
  // ordinary edit by an editor that has never heard of geometry must not erase it.
  const zoneShape = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const groupIn = (session: ProjectSession): TagGroup =>
    session.loaded.source!.boxes[0]!.tags.groups.find((g) => g.id === "d_zone")!;

  it("marks a group as a map, and stops, keesiteg any outlines", () => {
    const session = scratchProject();
    setGroupSpatial(session, encBox, "d_zone", true);
    setZonePolygon(session, encBox, "d_zone", "v_docks", zoneShape);
    expect(isSpatial(groupIn(session))).toBe(true);
    expect(polygonOf(groupIn(session).tags[0]!)).toEqual(zoneShape);

    // Turning it off is a display decision, not a licence to throw away an
    // afternoon of tracing.
    setGroupSpatial(session, encBox, "d_zone", false);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const group = reopened.session.loaded.source!.boxes[0]!.tags.groups.find((g) => g.id === "d_zone")!;
    expect(isSpatial(group)).toBe(false);
    expect(polygonOf(group.tags[0]!)).toEqual(zoneShape);
  });

  it("writes geometry to the TAGS shard and nowhere else", () => {
    const session = scratchProject();
    const before = readFileSync(dockDeckFile(session), "utf8");
    setZonePolygon(session, encBox, "d_zone", "v_docks", zoneShape);
    const tags = readFileSync(join(session.loaded.dir, "encounters", "tags.storylettags"), "utf8");
    expect(tags).toContain("polygon");
    // A zone is not content: no deck, and no arrangement sidecar either.
    expect(readFileSync(dockDeckFile(session), "utf8")).toBe(before);
    expect(existsSync(join(session.loaded.dir, "encounters", "view.storyletview"))).toBe(false);
  });

  it("keeps a zone's outline through an ordinary tag-group edit", () => {
    // The editor sends identity and properties; it has never heard of geometry.
    // Rebuilding each tag from that DTO alone erased the polygons, which is the
    // most expensive undo in the app and silent.
    const session = scratchProject();
    setZonePolygon(session, encBox, "d_zone", "v_docks", zoneShape);
    saveTagGroup(session, encBox, "d_zone", {
      values: [
        { id: "v_docks", gameId: "quayside", properties: [] },   // a rename
        { id: "v_market", gameId: "market", properties: [] },
      ],
    });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const group = reopened.session.loaded.source!.boxes[0]!.tags.groups.find((g) => g.id === "d_zone")!;
    expect(group.tags[0]!.gameId).toBe("quayside");
    expect(polygonOf(group.tags[0]!)).toEqual(zoneShape);
  });

  /** The sidecar, read back with the project's own parser (the shards are JSON5). */
  const sidecarOf = (session: ProjectSession): { map?: { sites?: Record<string, unknown> } } =>
    parseSource(readFileSync(join(session.loaded.dir, "encounters", "view.storyletview"), "utf8")) as
      { map?: { sites?: Record<string, unknown> } };
  const handsOf = (session: ProjectSession) =>
    session.loaded.source!.boxes.find((b) => b.box.box.id === encBox)!.hands.hands;

  /** Two zones side by side: the docks around the origin, the market to its
   *  right. The fixture ships tags with no geometry, and a rule about which zone
   *  a site is standing in needs zones to stand in. */
  const drawZones = (session: ProjectSession): void => {
    setZonePolygon(session, encBox, "d_zone", "v_docks",
      [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]);
    setZonePolygon(session, encBox, "d_zone", "v_market",
      [{ x: 220, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 220, y: 200 }]);
  };

  it("writes a site to the sidecar as a POSITION, and nothing else", () => {
    // Which zone it is in lives on the hand. A copy here could only go on to
    // disagree with it.
    const session = scratchProject();
    const hand = handsOf(session)[0]!.id;
    const result = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 40, y: 60 }]);
    expect("error" in result).toBe(false);
    expect(sidecarOf(session).map?.sites?.[hand]).toEqual({ x: 40, y: 60 });
  });

  it("REBINDS the hand when its site is dropped in another zone", () => {
    // The move the whole view exists for: dragging a site from the docks to the
    // market is not cosmetic, it edits the hand's chosen tag. Nobody says which
    // zone that is: the position over the geometry decides.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!;
    expect(hand.chosen).toEqual({ d_zone: "v_docks" });
    const moved = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand.id, x: 250, y: 50 }]);
    expect(moved).toMatchObject({ rebound: [{ id: hand.id, zone: "v_market" }] });
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });
  });

  it("leaves a hand LOOSE when its site lands outside every zone", () => {
    // Not a quiet keep-the-old-zone: the hand genuinely has no zone now, so the
    // binding goes and the compiler says what is wrong.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    const moved = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 900, y: 900 }]);
    expect(moved).toMatchObject({ rebound: [{ id: hand, zone: null }] });
    expect(handsOf(session)[0]!.chosen).toBeUndefined();
    // Named the way an author sees it: the group's gameId, not `d_zone`.
    expect("error" in moved ? [] : moved.result.problems.map((p) => p.message))
      .toContain('nothing chosen for the tag group "area": a hand fills every hole its template declares');
  });

  describe("importing a background", () => {
    /** A real 4x2 PNG, so `imageSize` reads a header an encoder wrote. */
    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000400000002080600000" +
      "0b4b0e1590000000a49444154789c6300010000050001" +
      "0d0a2db40000000049454e44ae426082", "hex");
    const place = { view: { width: 800, height: 400 }, scale: 1, at: { x: 100, y: 50 } };
    const groupOf = (session: ProjectSession): TagGroup =>
      session.loaded.source!.boxes.find((b) => b.box.box.id === encBox)!.tags.groups[0]!;

    it("copies the file in and places it by the drop rule, in one act", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      const added = addBackground(session, encBox, "d_zone", { name: "site-plan.png", bytes: PNG }, place);
      expect("error" in added).toBe(false);

      // The bytes are on disk, byte-identical.
      const onDisk = join(session.loaded.dir, "encounters", "assets", "site-plan.png");
      expect(readFileSync(onDisk).equals(PNG)).toBe(true);

      // And the entry is placed, centred on where the drop landed, 4:2 kept.
      const [bg] = backgroundsOf(groupOf(session));
      expect(bg?.file).toBe("site-plan.png");
      expect(bg!.x + bg!.width / 2).toBeCloseTo(100, 0);
      expect(bg!.y + bg!.height / 2).toBeCloseTo(50, 0);
      expect(bg!.width / bg!.height).toBeCloseTo(2, 1);
    });

    it("never replaces a picture already in use", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "plan.png", bytes: PNG }, place);
      addBackground(session, encBox, "d_zone", { name: "plan.png", bytes: PNG }, place);
      expect(backgroundsOf(groupOf(session)).map((b) => b.file)).toEqual(["plan.png", "plan-2.png"]);
    });

    it("puts a new picture at the FRONT, because you just added it", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "under.png", bytes: PNG }, place);
      addBackground(session, encBox, "d_zone", { name: "over.png", bytes: PNG }, place);
      expect(backgroundsOf(groupOf(session)).map((b) => b.file)).toEqual(["under.png", "over.png"]);
    });

    it("undoes the ENTRY and keeps the file, so no undo deletes a site plan", () => {
      // An orphan file is a far better outcome than an undo that destroys
      // somebody's only copy of an image, and a redo finds it still there.
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "site.png", bytes: PNG }, place);
      expect(undo(session)).not.toBeNull();
      expect(backgroundsOf(groupOf(session))).toEqual([]);
      expect(existsSync(join(session.loaded.dir, "encounters", "assets", "site.png"))).toBe(true);
    });

    it("moves, scales and fades one, coalescing a gesture into one undo step", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "site.png", bytes: PNG }, place);
      const id = backgroundsOf(groupOf(session))[0]!.id;

      // A drag then a scale: one continuous gesture each, and coalescing means one
      // undo takes the picture back to where it was imported.
      editBackground(session, encBox, "d_zone", id, { x: 10, y: 20 }, { coalesce: true });
      editBackground(session, encBox, "d_zone", id, { width: 400, height: 200 }, { coalesce: true });
      expect(backgroundsOf(groupOf(session))[0]).toMatchObject({ x: 10, y: 20, width: 400, height: 200 });

      // Fading is a discrete command: its OWN step, so it does not swallow the drag.
      editBackground(session, encBox, "d_zone", id, { opacity: 0.35 });
      expect(backgroundsOf(groupOf(session))[0]!.opacity).toBe(0.35);
      expect(undo(session)).not.toBeNull();
      const after = backgroundsOf(groupOf(session))[0]!;
      expect(after).toMatchObject({ x: 10, y: 20, width: 400, height: 200 });
      expect(after.opacity).toBeUndefined();   // the fade went, the gesture stayed
    });

    it("clears a flag rather than writing it false", () => {
      // An absent key is the default everywhere in these shards, and `hidden:
      // false` is noise in a merge.
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "site.png", bytes: PNG }, place);
      const id = backgroundsOf(groupOf(session))[0]!.id;
      editBackground(session, encBox, "d_zone", id, { hidden: true, locked: true });
      expect(backgroundsOf(groupOf(session))[0]).toMatchObject({ hidden: true, locked: true });
      editBackground(session, encBox, "d_zone", id, { hidden: false, locked: false });
      const raw = JSON.stringify(groupOf(session).templates);
      expect(raw).not.toContain("hidden");
      expect(raw).not.toContain("locked");
    });

    it("floors a scale and clamps a fade, so nothing becomes ungrabbable", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "site.png", bytes: PNG }, place);
      const id = backgroundsOf(groupOf(session))[0]!.id;
      editBackground(session, encBox, "d_zone", id, { width: 0, height: -50, opacity: 5 });
      const bg = backgroundsOf(groupOf(session))[0]!;
      expect(bg.width).toBeGreaterThan(0);
      expect(bg.height).toBeGreaterThan(0);
      expect(bg.opacity).toBe(1);
    });

    it("restacks among the pictures, and removing one keeps its file", () => {
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      addBackground(session, encBox, "d_zone", { name: "under.png", bytes: PNG }, place);
      addBackground(session, encBox, "d_zone", { name: "over.png", bytes: PNG }, place);
      const under = backgroundsOf(groupOf(session))[0]!.id;
      restackBackground(session, encBox, "d_zone", under, "front");
      expect(backgroundsOf(groupOf(session)).map((b) => b.file)).toEqual(["over.png", "under.png"]);

      // Removing takes the ENTRY. The file stays, becomes an orphan, and is swept
      // when the session ends - by which point no undo can want it back.
      removeBackground(session, encBox, "d_zone", under);
      expect(backgroundsOf(groupOf(session)).map((b) => b.file)).toEqual(["over.png"]);
      expect(existsSync(join(session.loaded.dir, "encounters", "assets", "under.png"))).toBe(true);
      expect(undo(session)).not.toBeNull();
      expect(backgroundsOf(groupOf(session)).map((b) => b.file)).toEqual(["over.png", "under.png"]);
    });

    it("refuses a group that is not a map", () => {
      const session = scratchProject();
      const added = addBackground(session, encBox, "d_zone", { name: "x.png", bytes: PNG }, place);
      expect("error" in added && added.error).toContain("not a map");
    });

    it("imports a format it cannot measure, rather than refusing it", () => {
      // An SVG has no header to read: a square guess beats rejecting a map.
      const session = scratchProject();
      setGroupSpatial(session, encBox, "d_zone", true);
      const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>");
      addBackground(session, encBox, "d_zone", { name: "plan.svg", bytes: svg }, place);
      const [bg] = backgroundsOf(groupOf(session));
      expect(bg?.file).toBe("plan.svg");
      expect(bg!.width).toBe(bg!.height);
    });
  });

  it("restacking a zone changes which one owns the sites in the overlap", () => {
    // The rule the map runs on, from a third direction: geometry did not move and
    // the site did not move, but what is in FRONT of what did.
    const session = scratchProject();
    // The market is drawn INSIDE the docks, and listed after it, so it starts in
    // front and owns anything standing in it.
    setZonePolygon(session, encBox, "d_zone", "v_docks",
      [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]);
    setZonePolygon(session, encBox, "d_zone", "v_market",
      [{ x: 40, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 120 }, { x: 40, y: 120 }]);
    const hand = handsOf(session)[0]!.id;
    moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 80, y: 80 }]);
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });

    const sent = restackZone(session, encBox, "d_zone", "v_market", "back");
    expect(sent).toMatchObject({ rebound: [{ id: hand, zone: "v_docks" }] });
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });

    // And back again, one undo step each way.
    restackZone(session, encBox, "d_zone", "v_market", "front");
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });
    expect(undo(session)).not.toBeNull();
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });
  });

  it("writes nothing for a move that would change nothing", () => {
    const session = scratchProject();
    drawZones(session);
    const before = readFileSync(join(session.loaded.dir, "encounters", "tags.storylettags"), "utf8");
    // v_market is listed last, so it is already the frontmost.
    const moved = restackZone(session, encBox, "d_zone", "v_market", "front");
    expect(moved).toMatchObject({ rebound: [] });
    expect(readFileSync(join(session.loaded.dir, "encounters", "tags.storylettags"), "utf8")).toBe(before);
  });

  it("clears the problem when the site is dragged back into a zone", () => {
    // The other half of the loose-hand story: fixing it must actually retract the
    // error, or an author who has done the right thing is still being told off.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    const missing = 'nothing chosen for the tag group "area"';

    const loosed = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 900, y: 900 }]);
    expect("error" in loosed ? [] : loosed.result.problems.map((p) => p.message).join())
      .toContain(missing);

    const fixed = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 250, y: 50 }]);
    expect("error" in fixed ? ["?"] : fixed.result.problems.map((p) => p.message).join())
      .not.toContain(missing);
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });
  });

  it("moves the hands a RESHAPED zone now covers, and looses the ones it has left", () => {
    // The same rule from the other side. A boundary dragged over a site has moved
    // that hand as surely as dragging the site would have.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 50, y: 50 }]);   // in the docks
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });

    // Shrink the docks away from the site: nothing else covers it, so it comes loose.
    const shrunk = setZonePolygon(session, encBox, "d_zone", "v_docks",
      [{ x: 500, y: 500 }, { x: 560, y: 500 }, { x: 560, y: 560 }, { x: 500, y: 560 }]);
    expect(shrunk).toMatchObject({ rebound: [{ id: hand, zone: null }] });
    expect(handsOf(session)[0]!.chosen).toBeUndefined();

    // Draw the market over where the site actually is: it takes the hand in.
    const grown = setZonePolygon(session, encBox, "d_zone", "v_market",
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(grown).toMatchObject({ rebound: [{ id: hand, zone: "v_market" }] });
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });
  });

  it("a zone's shape and the hands it moved are ONE undo step", () => {
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 50, y: 50 }]);
    setZonePolygon(session, encBox, "d_zone", "v_docks",
      [{ x: 500, y: 500 }, { x: 560, y: 500 }, { x: 560, y: 560 }, { x: 500, y: 560 }]);
    expect(handsOf(session)[0]!.chosen).toBeUndefined();
    expect(undo(session)).not.toBeNull();
    // The outline came back, so the hand it had loosed comes back with it.
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });
  });

  it("leaves an UNPLACED hand's binding alone: no position, no opinion", () => {
    // Otherwise opening a map would loose every hand nobody had placed yet.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    const other = handsOf(session)[0]!.chosen;
    setZonePolygon(session, encBox, "d_zone", "v_docks",
      [{ x: 500, y: 500 }, { x: 560, y: 500 }, { x: 560, y: 560 }, { x: 500, y: 560 }]);
    expect(handsOf(session).find((h) => h.id === hand)!.chosen).toEqual(other);
  });

  it("is ONE undo step: the site and the binding arrived from one gesture", () => {
    // Two shards, one commit. Undoing to a site in the market bound to the docks
    // would be a state the author never made.
    const session = scratchProject();
    drawZones(session);
    const hand = handsOf(session)[0]!.id;
    moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 250, y: 50 }]);
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_market" });
    const undone = undo(session);
    expect(undone).not.toBeNull();
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });
    // The sidecar did not exist before the drag, so undoing takes the whole file
    // back out rather than leaving an empty husk of a map behind.
    expect(existsSync(join(session.loaded.dir, "encounters", "view.storyletview"))).toBe(false);
  });

  it("will not move one hand off a binding its TEMPLATE owns", () => {
    // A fixed binding is shared by every instance, so dragging one site must not
    // move the rest. The site still goes where it was dropped.
    const session = scratchProject();
    drawZones(session);
    const box = session.loaded.source!.boxes.find((b) => b.box.box.id === encBox)!;
    const template = box.hands.templates.find((t) => t.id === "t_street")!;
    delete template.chooses;
    template.bindings = { d_zone: "v_docks" };
    const hand = handsOf(session)[0]!.id;

    const moved = moveSitesOnMap(session, encBox, "d_zone", [{ id: hand, x: 250, y: 50 }]);
    expect(moved).toMatchObject({ rebound: [] });
    expect(handsOf(session)[0]!.chosen).toEqual({ d_zone: "v_docks" });   // untouched
    expect(sidecarOf(session).map?.sites?.[hand]).toEqual({ x: 250, y: 50 });
  });

  it("is one undo step per shape", () => {
    const session = scratchProject();
    setGroupSpatial(session, encBox, "d_zone", true);
    setZonePolygon(session, encBox, "d_zone", "v_docks", zoneShape);
    undo(session);
    expect(polygonOf(groupIn(session).tags[0]!)).toBeUndefined();
    // And the group is still a map: the two acts are separate steps.
    expect(isSpatial(groupIn(session))).toBe(true);
  });
});

describe("tag group mutations", () => {
  it("reads a tag group's detail with tag properties", () => {
    const session = scratchProject();
    const detail = tagGroupDetail(session, encBox, "d_zone");
    expect(detail).not.toBeNull();
    expect(detail!.gameId).toBe("area");
    expect(detail!.values.map((v) => v.gameId)).toEqual(["docks", "market"]);
    expect(detail!.values[0]!.properties).toEqual([{ name: "danger", type: "number", default: "0" }]);
  });

  it("saves a tag group edit (new tag) and round-trips it", () => {
    const session = scratchProject();
    saveTagGroup(session, encBox, "d_zone", {
      values: [
        { id: "v_docks", gameId: "docks", properties: [{ name: "danger", type: "number", default: "1" }] },
        { id: "v_market", gameId: "market", properties: [] },
        { gameId: "temple", properties: [] },
      ],
    });
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const group = reopened.session.loaded.source!.boxes[0]!.tags.groups.find((d) => d.id === "d_zone")!;
    // STORAGE is id-sorted (rule 5), so the new tag lands wherever its random
    // id falls, not at the end. That is the whole point: two authors adding a
    // tag each do not both append.
    expect(group.tags.map((v) => v.id)).toEqual([...group.tags.map((v) => v.id)].sort());
    // DISPLAY order is what the author arranged, and rides in `order`.
    const shown = [...group.tags].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(shown.map((v) => v.gameId)).toEqual(["docks", "market", "temple"]);
    expect(shown[0]!.properties).toEqual([{ name: "danger", type: "number", default: 1 }]);
  });

  it("creates a tag group with a unique gameId, then deletes it", () => {
    const session = scratchProject();
    const created = createTagGroup(session, encBox);
    expect("error" in created).toBe(false);
    if ("error" in created) return;
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.boxes[0]!.tags.groups.find((d) => d.id === created.groupId)!.gameId)
      .toBe("new-group");
    const deleted = deleteTagGroup(session, encBox, created.groupId);
    expect("error" in deleted).toBe(false);
  });
});

describe("canvas furniture", () => {
  // #56. The interesting part is not the drawing (ops/view.test.ts sites the
  // format); it is that furniture is ARRANGEMENT: it touches the sidecar and
  // nothing else, and its undo steps follow the gesture rather than the entity.
  const frame = { id: "r_1", x: 0, y: 0, w: 120, h: 60, title: "Act one" };
  const sidecar = (session: ProjectSession): string =>
    join(session.loaded.dir, "encounters", "view.storyletview");

  it("writes the sidecar and no content shard", () => {
    const session = scratchProject();
    const deckBefore = readFileSync(dockDeckFile(session), "utf8");
    const result = setCanvasFurniture(session, encBox, { kind: "deck", deck: docks },
      { frames: [frame] }, "Draw a frame");
    expect("error" in result).toBe(false);
    expect(existsSync(sidecar(session))).toBe(true);
    expect(readFileSync(dockDeckFile(session), "utf8")).toBe(deckBefore);
  });

  it("keeps the two canvases apart", () => {
    const session = scratchProject();
    const onMap = { id: "r_2", x: 5, y: 5, w: 40, h: 40, title: "The docks" };
    setCanvasFurniture(session, encBox, { kind: "deck", deck: docks },
      { frames: [frame] }, "Draw a frame");
    setCanvasFurniture(session, encBox, { kind: "map" },
      { frames: [onMap] }, "Draw a frame");
    const shard = parseSource(readFileSync(sidecar(session), "utf8")) as ViewShard;
    expect(shard.canvases![docks]!.frames).toEqual([frame]);
    expect(shard.map!.frames).toEqual([onMap]);
  });

  it("a drag is one undo step however many frames it took; a command is its own", () => {
    const session = scratchProject();
    setCanvasFurniture(session, encBox, { kind: "map" }, { frames: [frame] }, "Draw a frame");
    // Three frames of one drag, sharing a coalescing key.
    for (const x of [10, 20, 30]) {
      setCanvasFurniture(session, encBox, { kind: "map" },
        { frames: [{ ...frame, x }] }, "Move", "furniture:move");
    }
    const moved = () => (parseSource(readFileSync(sidecar(session), "utf8")) as ViewShard).map!.frames![0]!;
    expect(moved().x).toBe(30);
    // One undo takes the whole drag back to where it started, not to frame two.
    undo(session);
    expect(moved().x).toBe(0);
    // And a second undo takes the frame away entirely: drawing it was its own
    // step. The box had no sidecar before it, so undoing back past the first
    // piece of furniture leaves NO FILE rather than an empty one - the same
    // "leave no husk" rule the writer follows going forwards.
    undo(session);
    expect(existsSync(sidecar(session))).toBe(false);
  });

  it("says so rather than throwing when the box has gone", () => {
    const session = scratchProject();
    expect(setCanvasFurniture(session, "b_nope", { kind: "map" },
      { frames: [] }, "Draw a frame")).toEqual({ error: "unknown box (id b_nope)" });
  });

  it("writes nothing when the furniture has not changed", () => {
    const session = scratchProject();
    setCanvasFurniture(session, encBox, { kind: "map" }, { frames: [frame] }, "Draw a frame");
    const before = readFileSync(sidecar(session), "utf8");
    setCanvasFurniture(session, encBox, { kind: "map" }, { frames: [frame] }, "Draw a frame");
    expect(readFileSync(sidecar(session), "utf8")).toBe(before);
  });
});

describe("threaded comments", () => {
  const notesFile = (session: ProjectSession): string =>
    join(session.loaded.dir, "encounters", "notes.storyletnotes");
  const threads = (session: ProjectSession): Comment[] =>
    commentsOf(session.loaded.source!.boxes.find((b) => b.box.box.id === encBox)!.notes);

  it("posting creates the thread; posting again replies to it", () => {
    const session = scratchProject();
    postComment(session, "k_docks", "cmt_1", "Ada", "Does this land too early?");
    expect(threads(session)).toHaveLength(1);
    postComment(session, "k_docks", "cmt_1", "Bo", "I think so.");
    const only = threads(session)[0]!;
    expect(only.messages.map((m) => m.author)).toEqual(["Ada", "Bo"]);
    expect(existsSync(notesFile(session))).toBe(true);
  });

  it("stamps a time on every message", () => {
    const session = scratchProject();
    postComment(session, "k_docks", "cmt_1", "Ada", "hello");
    const ts = threads(session)[0]!.messages[0]!.ts;
    expect(Number.isNaN(new Date(ts).getTime())).toBe(false);
  });

  // --- every commentable thing (design/annotation.md 2) ----------------------

  it("attaches to an OUTCOME, not only to the card that holds it", () => {
    // The gap when outcome comments were added: the opener appeared and the
    // popover opened, and only POSTING failed, because the box lookup did not
    // walk into a card's outcomes. Opening a popover is not evidence.
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    const outcome = card.outcomes[0]!;
    expect(postComment(session, outcome.id, "cmt_1", "Ada", "does this pay enough?"))
      .not.toHaveProperty("error");
    expect(threads(session)[0]!.anchor).toBe(outcome.id);
  });

  it("attaches to a box and to a tag group", () => {
    const session = scratchProject();
    expect(postComment(session, encBox, "cmt_1", "Ada", "about this box")).not.toHaveProperty("error");
    const group = session.loaded.source!.boxes.find((b) => b.box.box.id === encBox)!.tags.groups[0];
    if (group) {
      expect(postComment(session, group.id, "cmt_2", "Ada", "about this group")).not.toHaveProperty("error");
    }
  });

  // --- markers on a canvas (design/annotation.md 3) --------------------------

  it("a marker dropped on empty canvas is anchored to the canvas", () => {
    const session = scratchProject();
    postComment(session, docks, "cmt_1", "Ada", "this corner is empty", { canvas: docks, x: 40, y: 60 });
    const only = threads(session)[0]!;
    expect(only.anchor).toBe(docks);
    expect(markOf(only)).toEqual({ canvas: docks, x: 40, y: 60 });
  });

  it("a marker dropped on a card follows that card", () => {
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    postComment(session, card.id, "cmt_1", "Ada", "lands too early", { canvas: docks, x: 12, y: -8 });
    expect(markOf(threads(session)[0]!)).toEqual({ canvas: docks, x: 12, y: -8, item: card.id });
  });

  it("a REPLY cannot move a marker", () => {
    // Otherwise answering a comment from the other canvas would make it jump.
    const session = scratchProject();
    postComment(session, docks, "cmt_1", "Ada", "here", { canvas: docks, x: 40, y: 60 });
    postComment(session, docks, "cmt_1", "Bo", "agreed", { canvas: docks, x: 999, y: 999 });
    expect(markOf(threads(session)[0]!)).toEqual({ canvas: docks, x: 40, y: 60 });
  });

  it("dragging a marker onto a card attaches it, and off again detaches it", () => {
    // One code path for both, because the anchor is decided by where the drag
    // ENDED rather than remembered from where it began.
    const session = scratchProject();
    const card = session.dto.boxes[0]!.decks[0]!.cards[0]!;
    postComment(session, docks, "cmt_1", "Ada", "here", { canvas: docks, x: 40, y: 60 });

    moveComment(session, "cmt_1", docks, 10, 10, card.id);
    expect(markOf(threads(session)[0]!)).toEqual({ canvas: docks, x: 10, y: 10, item: card.id });

    moveComment(session, "cmt_1", docks, 300, 200);
    expect(markOf(threads(session)[0]!)).toEqual({ canvas: docks, x: 300, y: 200 });
  });

  it("says so rather than throwing when the marker has gone", () => {
    const session = scratchProject();
    expect(moveComment(session, "cmt_nope", docks, 0, 0)).toEqual({ error: "no such comment" });
  });

  it("resolving hides it from the counts; reopening brings it back", () => {
    const session = scratchProject();
    postComment(session, "k_docks", "cmt_1", "Ada", "hello");
    setCommentResolved(session, "cmt_1", true);
    expect(toDto(session.loaded).threads["k_docks"]).toBeUndefined();
    setCommentResolved(session, "cmt_1", false);
    expect(toDto(session.loaded).threads["k_docks"]).toBe(1);
  });

  it("a comment does not make the bundle stale either", () => {
    const session = scratchProject();
    const before = projectHash(session.loaded.source!);
    postComment(session, "k_docks", "cmt_1", "Ada", "hello");
    expect(projectHash(session.loaded.source!)).toBe(before);
  });

  it("says so rather than throwing when the anchor is not a thing", () => {
    const session = scratchProject();
    expect(postComment(session, "nope", "cmt_1", "Ada", "hello"))
      .toEqual({ error: "that is not something a comment can be attached to" });
    expect(setCommentResolved(session, "cmt_nope", true)).toEqual({ error: "no such comment" });
  });

});

// --- the problems bar's quick-fixes (storyletter.md section 4) ----------------

describe("quick-fixes", () => {
  /** Break the project the way an author does: point a change at a property
   *  nobody declared, and let the compiler raise the fix alongside. */
  const withUndeclaredChange = (): { session: ProjectSession; problems: Problem[] } => {
    const session = scratchProject();
    const source = session.loaded.source!;
    const deck = source.boxes[0]!.decks.find((d) => d.shard.deck.id === docks)!;
    const card = deck.shard.cards[0]!;
    const saved = saveCard(session, docks, card.id, {
      outcomes: [{ ...card.outcomes[0]!, changes: [{ target: "@story.nonesuch", value: "1" }] }],
    } as never);
    if ("error" in saved) throw new Error(saved.error);
    return { session, problems: saved.problems };
  };

  it("raises a declare-property fix WITH the diagnostic, so nothing parses a message", () => {
    const { problems } = withUndeclaredChange();
    const found = problems.find((p) => p.fix?.kind === "declare-property");
    // The fix carries the type read off the written value (here `1`, a number),
    // so the declaration it makes is not a blanket guess.
    expect(found?.fix).toEqual({
      kind: "declare-property", scope: "story", name: "nonesuch", owner: "",
      declType: "number", declDefault: 0,
    });
  });

  it("reads a latch as a boolean, which is the commonest write there is", () => {
    // The whole point of the change: `= true` used to declare a number
    // defaulting to 0, and the author had to go and fix every one.
    const { session } = withUndeclaredChange();
    const source = session.loaded.source!;
    const deck = source.boxes[0]!.decks[0]!;
    const card = deck.shard.cards[0]!;
    const saved = saveCard(session, deck.shard.deck.id, card.id, {
      outcomes: [{ ...card.outcomes[0]!, changes: [{ target: "@story.latched", value: "true" }] }],
    } as never);
    if ("error" in saved) throw new Error(saved.error);
    const fix = saved.problems.find((p) => p.fix?.kind === "declare-property")?.fix;
    expect(fix).toMatchObject({ name: "latched", declType: "boolean", declDefault: false });
  });

  it("declares the property, and the problem goes", () => {
    const { session, problems } = withUndeclaredChange();
    expect(problems.some((p) => p.fix?.kind === "declare-property")).toBe(true);

    const result = declareProperty(session, "story", "nonesuch", "");
    if ("error" in result) throw new Error(result.error);
    expect(result.problems.some((p) => p.message.includes("nonesuch"))).toBe(false);

    // A NUMBER defaulting to 0: the commonest case, and visible in the editor
    // the author is taken to, rather than a guess from the comparison literals.
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const decl = reopened.session.loaded.source!.project.story.properties.find((d) => d.name === "nonesuch");
    expect(decl).toEqual({ name: "nonesuch", type: "number", default: 0 });
  });

  it("refuses to declare one twice rather than writing a duplicate", () => {
    const { session } = withUndeclaredChange();
    declareProperty(session, "story", "nonesuch", "");
    expect(declareProperty(session, "story", "nonesuch", "")).toEqual({ error: '"nonesuch" is already declared' });
  });

  it("has no canonical home for @hand, and says so instead of guessing one", () => {
    const session = scratchProject();
    expect(declareProperty(session, "hand", "mood", "")).toEqual(
      { error: "@hand properties are not declared in one place" });
  });

  it("is one undo step, like any other edit", () => {
    const { session } = withUndeclaredChange();
    declareProperty(session, "story", "nonesuch", "");
    expect(undo(session)).not.toBeNull();
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.project.story.properties.some((d) => d.name === "nonesuch")).toBe(false);
  });

  it("says so plainly when the dangling reference has already gone", () => {
    const session = scratchProject();
    expect(repointTag(session, "h_nothing", "g_nothing", "t_old", "t_new"))
      .toEqual({ error: "that tag reference has already gone" });
  });
});

// --- gameIds that did not come through the editor -----------------------------
//
// The editor CANNOT produce an illegal address: every save path runs the typed
// value through `gameIdify`, whose output is always legal or empty. These are
// the shards that arrive some other way - hand-edited, produced by another tool,
// unpacked, merged - where nothing had ever looked.

describe("an illegal pinned gameId", () => {
  /** Poison a deck's gameId the way a text editor would, behind the app's back. */
  const poison = (session: ProjectSession, gameId: string): void => {
    const deck = session.loaded.source!.boxes[0]!.decks.find((d) => d.shard.deck.id === docks)!;
    deck.shard.deck.gameId = gameId;
  };

  it("is reported by validate, which never looked before", () => {
    const session = scratchProject();
    poison(session, "Not An Address");
    const issues = runValidate(session.loaded, { checkBundle: false }).issues;
    expect(issues.some((i) =>
      i.severity === "error" && i.message.includes('deck gameId "Not An Address" is not a legal address'))).toBe(true);
  });

  it("does NOT flag an entity that simply has no pinned gameId", () => {
    // The two derived paths are safe by construction and must not be checked:
    // `gameIdify` always yields something legal, and the last resort is the
    // entity's own id, which carries an underscore ("c_arrive") by convention.
    const session = scratchProject();
    const deck = session.loaded.source!.boxes[0]!.decks.find((d) => d.shard.deck.id === docks)!;
    delete deck.shard.deck.gameId;
    delete deck.shard.deck.title;
    const issues = runValidate(session.loaded, { checkBundle: false }).issues;
    expect(issues.some((i) => i.message.includes("is not a legal address"))).toBe(false);
  });

  it("refuses the rename that would write the file, with a message rather than a crash", () => {
    // Renaming only the TITLE leaves the pinned gameId alone and hands it to the
    // path builder, which is how a poisoned shard reaches a write.
    const session = scratchProject();
    poison(session, "../../../evil");
    const result = renameDeck(session, docks, { title: "Harmless retitle" });
    expect(result).toEqual({
      error: 'this deck\'s gameId "../../../evil" is not a legal address, so it cannot be saved under it. Fix the gameId first.',
    });
  });

  it("leaves nothing outside the project when it refuses", () => {
    const session = scratchProject();
    poison(session, "../../../evil");
    renameDeck(session, docks, { title: "Harmless retitle" });
    expect(existsSync(join(session.loaded.dir, "..", "..", "..", "evil.storyletdeck"))).toBe(false);
  });

  it("still renames a deck whose address is legal", () => {
    const session = scratchProject();
    const result = renameDeck(session, docks, { title: "The Docks At Night" });
    expect("error" in result).toBe(false);
  });
});

// --- deleting a comment (design/annotation.md 9) -------------------------------

describe("withdrawing a comment", () => {
  const seed = (session: ProjectSession, bodies: string[]): string => {
    const id = "cmt_del";
    bodies.forEach((body) => {
      const r = postComment(session, docks, id, "Ada", body);
      if ("error" in r) throw new Error(r.error);
    });
    return id;
  };

  it("takes the whole thread when the withdrawn message was the only one", () => {
    // The "solo" case, and it falls out of the one rule rather than being its
    // own branch: nothing readable is left, so there is no thread.
    const session = scratchProject();
    const id = seed(session, ["Only thing I had to say"]);
    const result = deleteCommentMessage(session, id, 0);
    if ("error" in result) throw new Error(result.error);
    const box = session.loaded.source!.boxes[0]!;
    expect(commentsOf(box.notes).some((t) => t.id === id)).toBe(false);
  });

  it("leaves a tombstone when the thread carries on around it", () => {
    const session = scratchProject();
    const id = seed(session, ["First", "Second", "Third"]);
    const result = deleteCommentMessage(session, id, 1);
    if ("error" in result) throw new Error(result.error);
    const thread = commentsOf(session.loaded.source!.boxes[0]!.notes).find((t) => t.id === id)!;
    expect(thread.messages).toHaveLength(3);
    expect(thread.messages[1]!.deleted).toBe(true);
    // The turn survives; the words do not.
    expect(thread.messages[1]!.body).toBe("");
    expect(thread.messages[1]!.author).not.toBe("");
    expect(thread.messages.map((m) => m.body)).toEqual(["First", "", "Third"]);
  });

  it("really removes the words from the FILE, not just from the view", () => {
    // "Deleted" has to mean deleted: the person reaching for this may have typed
    // something they regret, in a directory under version control.
    const session = scratchProject();
    const id = seed(session, ["Keep me", "Regrettable"]);
    deleteCommentMessage(session, id, 1);
    const onDisk = readFileSync(join(session.loaded.dir, "encounters", "notes.storyletnotes"), "utf8");
    expect(onDisk).not.toContain("Regrettable");
    expect(onDisk).toContain("Keep me");
  });

  it("survives a reload: a tombstone is the one empty message the reader keeps", () => {
    const session = scratchProject();
    const id = seed(session, ["First", "Second"]);
    deleteCommentMessage(session, id, 0);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    const thread = commentsOf(reopened.session.loaded.source!.boxes[0]!.notes).find((t) => t.id === id)!;
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]!.deleted).toBe(true);
  });

  it("takes the thread when the LAST readable message goes, so tombstones cannot pile up", () => {
    const session = scratchProject();
    const id = seed(session, ["One", "Two"]);
    deleteCommentMessage(session, id, 0);
    const result = deleteCommentMessage(session, id, 1);
    if ("error" in result) throw new Error(result.error);
    expect(commentsOf(session.loaded.source!.boxes[0]!.notes).some((t) => t.id === id)).toBe(false);
  });

  it("refuses to withdraw the same message twice", () => {
    const session = scratchProject();
    const id = seed(session, ["First", "Second"]);
    deleteCommentMessage(session, id, 0);
    expect(deleteCommentMessage(session, id, 0)).toEqual({ error: "that comment is already deleted" });
  });

  it("says so plainly when the index is not there", () => {
    const session = scratchProject();
    const id = seed(session, ["Only"]);
    expect(deleteCommentMessage(session, id, 4)).toEqual({ error: "that comment has already gone" });
  });

  it("is one undo step, like any other edit", () => {
    const session = scratchProject();
    const id = seed(session, ["First", "Second"]);
    deleteCommentMessage(session, id, 1);
    expect(undo(session)).not.toBeNull();
    const thread = commentsOf(session.loaded.source!.boxes[0]!.notes).find((t) => t.id === id)!;
    expect(thread.messages[1]!.body).toBe("Second");
  });
});

describe("shared scarcity, written from the editor", () => {
  // Files are the truth, so every assertion reads a fresh open.
  const card = (session: ReturnType<typeof scratchProject>, gameId: string) => {
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    return reopened.session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === gameId)!;
  };

  it("writes the deck's flag only when true, so an ordinary deck stays quiet", () => {
    const session = scratchProject();
    renameDeck(session, docks, { shared: true });
    expect(readFileSync(dockDeckFile(session), "utf8")).toContain("shared: true");
    renameDeck(session, docks, { shared: false });
    expect(readFileSync(dockDeckFile(session), "utf8")).not.toContain("shared: true");
  });

  it("a card's override is three-state: inherit CLEARS it rather than writing false", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { shared: true });
    expect(card(session, "rat-job").shared).toBe(true);
    // Not shared is a real answer, distinct from saying nothing: it overrides a
    // shared deck.
    saveCard(session, docks, ratJob.id, { shared: false });
    expect(card(session, "rat-job").shared).toBe(false);
    saveCard(session, docks, ratJob.id, { shared: null });
    expect(card(session, "rat-job").shared).toBeUndefined();
  });

  it("sharedCopies takes an integer >= 1; blank or nonsense clears it", () => {
    const session = scratchProject();
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!;
    saveCard(session, docks, ratJob.id, { sharedCopies: "5" });
    expect(card(session, "rat-job").sharedCopies).toBe("5");
    saveCard(session, docks, ratJob.id, { sharedCopies: "" });
    expect(card(session, "rat-job").sharedCopies).toBe("");
    saveCard(session, docks, ratJob.id, { sharedCopies: "nope" });
    expect(card(session, "rat-job").sharedCopies).toBe("");
  });
});
