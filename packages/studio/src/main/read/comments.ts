// ---------------------------------------------------------------------------
// What the comment surfaces read: one thing's threads, the markers on one
// canvas, and every thread in reading order for the Review Feedback walk.
//
// A thread hangs off ANY id, so each of these finds what an id belongs to
// before it can answer. That lookup lives in main rather than in the renderer
// because the containment is the project's shape, not the view's.
// ---------------------------------------------------------------------------

import { PROJECT_MAP_CANVAS } from "@storylet-studio/ops";
import { byDisplayOrder, commentsOf, effectiveGameId, markOf, marksOn, threadsFor } from "@storylet-studio/model";
import type { Comment } from "@storylet-studio/model";
import type { ProjectSession } from "../project.js";
import { MAP_CANVAS, PROJECT_MAP_CANVAS_ID } from "../../shared/api.js";
import type { CommentDto, CommentMarkerDto, ReviewAt, ReviewItemDto } from "../../shared/api.js";

/** The threads about one thing, oldest first, resolved ones included. */
export function commentsFor(session: ProjectSession | undefined, anchor: string): CommentDto[] {
  const source = session?.loaded.source;
  if (!source) return [];
  // The root notes last: the project map and its zones are the only things
  // whose threads live there (design/project-map-contract.md 1.1).
  for (const notes of [...source.boxes.map((b) => b.notes), source.notes]) {
    const threads = threadsFor(notes, anchor);
    if (threads.length > 0) return threads;
  }
  return [];
}

/** A thread's first message as a one-line preview, and who wrote it. */
const opener = (thread: Comment): { author: string; text: string } => {
  const first = thread.messages[0];
  return { author: first?.author ?? "", text: (first?.body ?? "").split("\n")[0] ?? "" };
};

/**
 * Every thread in the project, resolved into somewhere the walk can GO.
 *
 * An anchor id says nothing about what it is, and the containment that turns
 * it into "Village, Arrival, Arrive at the Gate" is the project's shape, not
 * the view's.
 *
 * READING ORDER, not the shard's: boxes as the navigator lists them, then
 * decks, then cards, then each card's outcomes. A walk that jumped about would
 * make the count meaningless as a sense of progress.
 */
export function reviewFeedback(session: ProjectSession | undefined, showResolved: boolean): ReviewItemDto[] {
  const source = session?.loaded.source;
  if (!source) return [];
  const out: ReviewItemDto[] = [];
  for (const box of source.boxes) {
    const boxName = effectiveGameId(box.box.box);
    const threads = commentsOf(box.notes);
    // A thread dropped on EMPTY canvas is filed against the canvas's owner, so
    // the owner's pass and the canvas pass below would both claim it and the
    // walk would step through it twice. The canvas pass owns it: that is where
    // the marker is, and where the reviewer put it.
    const byAnchor = (anchor: string): Comment[] =>
      threads.filter((t) => t.anchor === anchor && t.mark?.canvas !== t.anchor);
    const add = (thread: Comment, at: ReviewAt, where: string): void => {
      if (thread.resolved === true && !showResolved) return;
      const { author, text } = opener(thread);
      out.push({
        thread: thread.id, anchor: thread.anchor, at, where,
        ...(thread.mark ? { canvas: thread.mark.canvas } : {}),
        author, text,
        ...(thread.resolved === true ? { resolved: true } : {}),
      });
    };

    for (const t of byAnchor(box.box.box.id)) add(t, { kind: "box", box: box.box.box.id }, boxName);
    for (const deck of box.decks) {
      const deckName = effectiveGameId(deck.shard.deck);
      for (const t of byAnchor(deck.shard.deck.id)) {
        add(t, { kind: "deck", box: box.box.box.id, deck: deck.shard.deck.id }, `${boxName} / ${deckName}`);
      }
      for (const card of deck.shard.cards) {
        const cardName = card.title ?? effectiveGameId(card);
        const at: ReviewAt = { kind: "card", box: box.box.box.id, deck: deck.shard.deck.id, card: card.id };
        for (const t of byAnchor(card.id)) add(t, at, `${boxName} / ${deckName} / ${cardName}`);
        for (const outcome of byDisplayOrder(card.outcomes)) {
          const name = outcome.title ?? effectiveGameId(outcome);
          for (const t of byAnchor(outcome.id)) {
            add(t, {
              kind: "outcome", box: box.box.box.id, deck: deck.shard.deck.id, card: card.id, outcome: outcome.id,
            }, `${boxName} / ${deckName} / ${cardName} / ${name}`);
          }
        }
      }
    }
    for (const hand of box.hands.hands) {
      for (const t of byAnchor(hand.id)) {
        add(t, { kind: "hand", box: box.box.box.id, hand: hand.id }, `${boxName} / ${effectiveGameId(hand)}`);
      }
    }
    for (const template of box.hands.templates) {
      for (const t of byAnchor(template.id)) {
        add(t, { kind: "template", box: box.box.box.id, template: template.id }, `${boxName} / ${effectiveGameId(template)}`);
      }
    }
    for (const group of box.tags.groups) {
      for (const t of byAnchor(group.id)) {
        add(t, { kind: "tagGroup", box: box.box.box.id, group: group.id }, `${boxName} / ${effectiveGameId(group)}`);
      }
    }
    // Threads anchored to a CANVAS rather than to a thing on it. They have no
    // editor of their own, so the walk opens the canvas: the deck's for a deck
    // canvas, the box's map for a map.
    for (const t of threads) {
      const canvas = t.mark?.canvas;
      if (canvas === undefined || t.anchor !== canvas) continue;
      const deck = box.decks.find((d) => d.shard.deck.id === canvas);
      if (deck) add(t, { kind: "deck", box: box.box.box.id, deck: deck.shard.deck.id }, `${boxName} / ${effectiveGameId(deck.shard.deck)} / canvas`);
      else if (canvas === `${MAP_CANVAS}${box.box.box.id}`) add(t, { kind: "box", box: box.box.box.id }, `${boxName} / map`);
      else if (canvas === PROJECT_MAP_CANVAS_ID) add(t, { kind: "map" }, `Map`);
    }
  }
  // The project's own threads, last: the map itself and its zones, which
  // belong to no box. Each opens the map page, where its marker is.
  for (const t of commentsOf(source.notes)) {
    if (t.resolved === true && !showResolved) continue;
    const { author, text } = opener(t);
    const zone = source.map?.group.tags.find((z) => z.id === t.anchor);
    out.push({
      thread: t.id, anchor: t.anchor, at: { kind: "map" },
      where: zone !== undefined ? `Map / ${effectiveGameId(zone)}` : "Map",
      ...(t.mark ? { canvas: t.mark.canvas } : {}),
      author, text,
      ...(t.resolved === true ? { resolved: true } : {}),
    });
  }
  return out;
}

/**
 * The markers on one canvas, resolved so the renderer draws rather than
 * decides: which kind each is, its badge count, and its hover line.
 *
 * Searched across every box because a canvas name is unique project-wide (a
 * deck id, or `map:<boxId>`), and the renderer asking about "this canvas" does
 * not know or care which box's sidecar the threads landed in.
 */
export function commentMarkers(session: ProjectSession | undefined, canvas: string): CommentMarkerDto[] {
  const source = session?.loaded.source;
  if (!source) return [];
  const out: CommentMarkerDto[] = [];
  // A box's map canvas also shows the threads `storyletengine format` moved
  // onto the project map's canvas, `map`, that stayed in the box because they
  // are about one of its sites (design/project-map-contract.md 1.1).
  //
  // The PROJECT map's canvas (`map`) gathers from everywhere: the root notes
  // hold threads about the map and its zones, each box's notes the threads
  // about its own sites, and a box map's old `map:<box>` canvas, which only a
  // project not yet formatted still has, is read as the same place.
  const mapOf = canvas.startsWith(MAP_CANVAS) ? canvas.slice(MAP_CANVAS.length) : undefined;
  const onProjectMap = canvas === PROJECT_MAP_CANVAS_ID;
  const holders = [
    ...source.boxes.map((box) => ({ notes: box.notes, legacy: `${MAP_CANVAS}${box.box.box.id}`, id: box.box.box.id })),
    ...(onProjectMap ? [{ notes: source.notes, legacy: undefined, id: undefined }] : []),
  ];
  for (const holder of holders) {
    const onCanvas = [
      ...marksOn(holder.notes, canvas),
      ...(mapOf !== undefined && mapOf === holder.id ? marksOn(holder.notes, PROJECT_MAP_CANVAS) : []),
      ...(onProjectMap && holder.legacy !== undefined ? marksOn(holder.notes, holder.legacy) : []),
    ];
    for (const thread of onCanvas) {
      const at = markOf(thread);
      if (!at) continue;
      // The first message that still SAYS something, and a count of the same:
      // a withdrawn message is a turn in the conversation, not something left
      // to read, so a marker whose opener was deleted previews what carried on
      // rather than showing a blank hover.
      const live = thread.messages.filter((m) => m.deleted !== true);
      const first = live[0];
      out.push({
        id: thread.id, x: at.x, y: at.y,
        ...(at.item !== undefined ? { item: at.item } : {}),
        open: thread.resolved === true ? 0 : live.length,
        gist: (first?.body ?? "").split("\n")[0] ?? "",
        author: first?.author ?? "",
      });
    }
  }
  return out;
}
