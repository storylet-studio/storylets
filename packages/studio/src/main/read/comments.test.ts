// What the comment surfaces read (read/comments.ts), headless on a copy of the
// Village with threads posted through the write path: the Review Feedback
// walk's order and wording, and the markers on a canvas.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveGameId } from "@storylet-studio/model";
import { openProject } from "../project.js";
import type { ProjectSession } from "../project.js";
import { deleteCommentMessage, postComment, setCommentResolved } from "../mutate/comments.js";
import { commentMarkers, commentsFor, reviewFeedback } from "./comments.js";

const exampleDir = fileURLToPath(new URL("../../../../../examples/the-village.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-comments-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

/** The first box, its first deck and that deck's first card. */
function firsts(s: ProjectSession) {
  const box = s.loaded.source!.boxes[0]!;
  const deck = box.decks[0]!;
  const card = deck.shard.cards[0]!;
  return { box, deck, card };
}

describe("the Review Feedback walk", () => {
  it("is empty with nothing open", () => {
    expect(reviewFeedback(undefined, true)).toEqual([]);
  });

  it("walks in reading order (box, then its decks and cards, then the map), naming where each is", async () => {
    const s = scratch();
    const { box, deck, card } = firsts(s);
    const zone = s.loaded.source!.map!.group.tags[0]!;
    // Posted out of order, so the walk's order is its own.
    await postComment(s, zone.id, "t-zone", "Ann", "about the zone");
    await postComment(s, card.id, "t-card", "Bea", "first line\nsecond line");
    await postComment(s, box.box.box.id, "t-box", "Cal", "about the box");
    const walk = reviewFeedback(s, false);
    expect(walk.map((w) => w.thread)).toEqual(["t-box", "t-card", "t-zone"]);
    const boxName = effectiveGameId(box.box.box);
    expect(walk[1]).toMatchObject({
      at: { kind: "card", box: box.box.box.id, deck: deck.shard.deck.id, card: card.id },
      where: `${boxName} / ${effectiveGameId(deck.shard.deck)} / ${card.title ?? effectiveGameId(card)}`,
      author: "Bea", text: "first line",
    });
    expect(walk[2]).toMatchObject({ at: { kind: "map" }, where: `Map / ${effectiveGameId(zone)}` });
  });

  it("leaves a resolved thread out unless asked to show it, and marks it when shown", async () => {
    const s = scratch();
    const { card } = firsts(s);
    await postComment(s, card.id, "t-done", "Ann", "done with");
    await setCommentResolved(s, "t-done", true);
    expect(reviewFeedback(s, false)).toEqual([]);
    expect(reviewFeedback(s, true)[0]).toMatchObject({ thread: "t-done", resolved: true });
  });

  it("visits a thread dropped on empty canvas once, as the canvas's", async () => {
    const s = scratch();
    const { deck } = firsts(s);
    const canvas = deck.shard.deck.id;
    await postComment(s, canvas, "t-canvas", "Ann", "on the canvas", { canvas, x: 1, y: 2 });
    const walk = reviewFeedback(s, false).filter((w) => w.thread === "t-canvas");
    expect(walk).toHaveLength(1);
    expect(walk[0]!.where).toBe(`${effectiveGameId(firsts(s).box.box.box)} / ${effectiveGameId(deck.shard.deck)} / canvas`);
    expect(walk[0]!.canvas).toBe(canvas);
  });
});

describe("a canvas's comment markers", () => {
  it("previews the first message still readable, and counts only those", async () => {
    const s = scratch();
    const { deck, card } = firsts(s);
    const canvas = deck.shard.deck.id;
    await postComment(s, card.id, "t-m", "Ann", "withdrawn soon", { canvas, x: 10, y: 20 });
    await postComment(s, card.id, "t-m", "Bea", "the reply\nmore");
    await deleteCommentMessage(s, "t-m", 0);
    expect(commentMarkers(s, canvas)).toEqual([{ id: "t-m", x: 10, y: 20, item: card.id, open: 1, gist: "the reply", author: "Bea" }]);
  });

  it("counts a resolved thread as nothing open", async () => {
    const s = scratch();
    const { deck, card } = firsts(s);
    await postComment(s, card.id, "t-r", "Ann", "settled", { canvas: deck.shard.deck.id, x: 0, y: 0 });
    await setCommentResolved(s, "t-r", true);
    expect(commentMarkers(s, deck.shard.deck.id)[0]!.open).toBe(0);
  });

  it("gathers the project map's canvas from the root notes and from the boxes", async () => {
    const s = scratch();
    const zone = s.loaded.source!.map!.group.tags[0]!;
    const { box } = firsts(s);
    await postComment(s, zone.id, "t-root", "Ann", "about a zone", { canvas: "map", x: 1, y: 1 });
    await postComment(s, `map:${box.box.box.id}`, "t-legacy", "Bea", "an old box map", { canvas: `map:${box.box.box.id}`, x: 2, y: 2 });
    expect(commentMarkers(s, "map").map((m) => m.id).sort()).toEqual(["t-legacy", "t-root"]);
    expect(commentMarkers(undefined, "map")).toEqual([]);
  });

  it("answers a thing's threads from wherever they are kept", async () => {
    const s = scratch();
    const zone = s.loaded.source!.map!.group.tags[0]!;
    await postComment(s, zone.id, "t-z", "Ann", "zone thread");
    expect(commentsFor(s, zone.id).map((t) => t.id)).toEqual(["t-z"]);
    expect(commentsFor(s, "nothing-here")).toEqual([]);
  });
});
