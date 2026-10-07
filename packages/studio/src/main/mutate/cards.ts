// ---------------------------------------------------------------------------
// Cards: their edits, their making, their order, and where they sit on a
// deck's canvas (with the canvas's frames, which are the same arranging
// layer).
// ---------------------------------------------------------------------------

import { parseSource } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { analyseInfluence, bindingsOfHand, layoutByDependency, mapSites, newId, planCanvasFurniture, planCardPositions } from "@storylet-studio/ops";
import type { CanvasRef, CardPlacement } from "@storylet-studio/ops";
import { PLACE_GROUP, effectiveGameId, freeTitle, gameIdify, groupsOfBox, isHoleRef } from "@storylet-studio/model";
import type { CanvasFurniture, Card, Hand, Outcome, RedrawPolicy, ScalarValue } from "@storylet-studio/model";
import type { FileState } from "../history.js";
import { axisBox, axisMap, boxWithMap } from "../project.js";
import type { ProjectSession } from "../project.js";
import { allFinite } from "../trust.js";
import type { CardEdit, OpenResult } from "../../shared/api.js";
import { commit, commitMaking, freshKey, reload } from "./write-path.js";
import type { Written } from "./write-path.js";
import {
  allCardGameIds, applyIdentity, blank, dedupedGameId, deckWrite, finitePoints, gone, locate, locateBox, midpointOrder,
  refusedNumber, stampOrder,
} from "./shards.js";

/** A number literal stays a number; anything else is a priority expression. */
function coercePriority(raw: string): number | string {
  const t = raw.trim();
  if (t === "") return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : raw;
}

function coerceRedraw(raw: string): RedrawPolicy {
  if (raw === "always" || raw === "never") return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : "always";
}

/** A field value edited as text: JSON5 where it parses to a scalar, else the
 *  raw string (the validator is the net for a type mismatch). */
function coerceField(raw: string): ScalarValue {
  try {
    const v = parseSource(raw);
    if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  } catch {
    // fall through
  }
  return raw;
}

/** Field rows as stored: a blank value is no value, so its key goes. */
function fieldsOf(rows: { name: string; value: string }[]): Record<string, ScalarValue> {
  const fields: Record<string, ScalarValue> = {};
  for (const { name, value } of rows) if (!blank(value)) fields[name] = coerceField(value);
  return fields;
}

/** Resolve tag gameIds (group -> tags) back to stored ids; the reserved home
 *  group's values are hand gameIds, resolved to hand ids. */
function resolveTags(box: SourceBox, edit: NonNullable<CardEdit["tags"]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { group, values } of edit) {
    if (values.length === 0) continue;
    if (group === PLACE_GROUP) {
      out[PLACE_GROUP] = values
        .map((v) => box.hands.hands.find((h) => effectiveGameId(h) === v)?.id)
        .filter((id): id is string => id !== undefined);
      continue;
    }
    const g = box.tags.groups.find((d) => d.gameId === group);
    if (!g) continue;
    out[g.id] = values
      .map((v) => g.tags.find((tag) => tag.gameId === v)?.id)
      .filter((id): id is string => id !== undefined);
  }
  return out;
}

/** Merge a CardEdit onto the existing source card, preserving identity. */
function applyEdit(box: SourceBox, existing: Card<string>, edit: CardEdit): Card<string> {
  const next: Card<string> = { ...existing };
  applyIdentity(next, edit);
  if (edit.condition !== undefined) { if (blank(edit.condition)) delete next.condition; else next.condition = edit.condition; }
  if (edit.priority !== undefined) next.priority = coercePriority(edit.priority);
  if (edit.redraw !== undefined) next.redraw = coerceRedraw(edit.redraw);
  if (edit.tags !== undefined) {
    const resolved = resolveTags(box, edit.tags);
    if (Object.keys(resolved).length > 0) next.tags = resolved; else delete next.tags;
  }
  if (edit.copies !== undefined) {
    const n = Number(edit.copies);
    if (edit.copies.trim() && Number.isInteger(n) && n >= 2) next.copies = n; else delete next.copies;
  }
  // Scarcity across flows (design/shared-scarcity.md). null is the third state:
  // clear the card's override and let the deck's flag stand, which is what the
  // "inherit" choice writes.
  if (edit.shared !== undefined) {
    if (edit.shared === null) delete next.shared; else next.shared = edit.shared;
  }
  if (edit.sharedCopies !== undefined) {
    const n = Number(edit.sharedCopies);
    if (edit.sharedCopies.trim() && Number.isInteger(n) && n >= 1) next.sharedCopies = n;
    else delete next.sharedCopies;
  }
  // Durability across the RUN (design/engine-server.md 4.2), the same three
  // states for the same reason: null clears the card's override and lets the
  // deck's flag stand.
  if (edit.durable !== undefined) {
    if (edit.durable === null) delete next.durable; else next.durable = edit.durable;
  }
  if (edit.fields !== undefined) {
    // A blank value is no value: the key goes, and the host falls back to the
    // declared default, which is the only thing a default is for (the compiler
    // never fills one and the runtime hands the sparse map through). Storing
    // the "" used to leave a typed field impossible to unset: "(unset)" in a
    // boolean or enum picker stored a string that then failed publish for not
    // being a boolean. Patterpad's sparse game data is the same rule (ruled
    // 2026-09-13, with outcome fields, which were written this way first).
    const fields = fieldsOf(edit.fields);
    if (Object.keys(fields).length > 0) next.fields = fields; else delete next.fields;
  }
  if (edit.outcomes !== undefined) {
    // Stamp `order` from the incoming position. Outcomes are stored id-sorted
    // (rule 5), so without this the list the author arranged comes back
    // alphabetised by a random id, and a new one lands wherever its id falls.
    next.outcomes = edit.outcomes.map((o, i): Outcome<string> => {
      const changes: Record<string, string> = {};
      for (const c of o.changes) if (!blank(c.value) && !blank(c.target)) changes[c.target] = c.value;
      const outcome: Outcome<string> = { id: o.id, order: i, changes };
      // A blank gameId leaves the address derived (from the title), like a card.
      const gid = gameIdify(o.gameId);
      if (gid) outcome.gameId = gid;
      if (o.title?.trim()) outcome.title = o.title;
      if (o.purpose?.trim()) outcome.purpose = o.purpose;
      if (!blank(o.gate)) outcome.condition = o.gate;
      // The outcome's own fields, through the SAME coercion as the card's
      // above: a blank value is no value (the key goes), and an outcome with
      // nothing set carries no `fields` key at all, so every project written
      // before the key existed saves back byte-identical.
      if (o.fields !== undefined) {
        const fields = fieldsOf(o.fields);
        if (Object.keys(fields).length > 0) outcome.fields = fields;
      }
      return outcome;
    });
  }
  return next;
}

export async function saveCard(session: ProjectSession, deckId: string, cardId: string, edit: CardEdit): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  const index = found.deck.shard.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return gone("card");
  const updated = applyEdit(boxWithMap(session.loaded.source, found.box), found.deck.shard.cards[index]!, edit);
  found.deck.shard.cards[index] = updated;
  // Consecutive edits to one card coalesce into a single undo step.
  return commit(session, `Edit ${updated.gameId}`, `card:${cardId}`, [deckWrite(session, found.deck)]);
}

/** What a new card IS: the shape both create paths mint.
 *
 *  One function because it was two identical blocks, in this file, six lines
 *  each - and the thing they define is a DEFAULT, which is exactly the kind of
 *  thing that gets extended. The shared-scarcity work added card-level fields;
 *  the next such change would have landed in one of the two and not the other,
 *  and nothing would have said so. */
function newCard(session: ProjectSession): Card<string> {
  const title = freeTitle("New card", allCardGameIds(session));
  return {
    id: newId("c"), title, priority: 0, redraw: "always",
    outcomes: [{ id: newId("o"), title: "Continue", changes: {} }],
  };
}

export async function createCard(
  session: ProjectSession, deckId: string, place?: string,
  /** Filed to a zone of the project map instead (the zone panel's "+ New card
   *  here"): tagged with it, so it can come up anywhere in that zone. */
  zone?: string,
): Promise<{ result: OpenResult; cardId: string } | { error: string }> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  const map = session.loaded.source!.map;
  if (zone !== undefined && (map === undefined || found.box.box.box.usesMap !== true || !map.group.tags.some((t) => t.id === zone))) {
    return { error: "that zone isn't on this deck's project map" };
  }
  // Made AT a hand (its page's "+ New card here"): the hand has to be one this
  // deck's box deals to, since a hand deals only from its own box's decks and a
  // place naming another box's hand is a card that can never come up.
  if (place !== undefined && !found.box.hands.hands.some((h) => h.id === place)) {
    return gone("hand in this box");
  }
  // No pinned gameId: it derives from the title, so it follows the first
  // real title the author types (never a stuck "new-card"). Dedupe the
  // placeholder title so freshly-made cards start valid and unique.
  const card = newCard(session);
  if (place !== undefined) card.tags = tagsToComeUpAt(session, found.box, found.box.hands.hands.find((h) => h.id === place)!);
  else if (zone !== undefined) card.tags = { [map!.group.id]: [zone] };
  found.deck.shard.cards.push(card);
  return commitMaking(session, "New card", freshKey(), [deckWrite(session, found.deck)], { cardId: card.id });
}

/**
 * The tags that make a new card come up at one hand, by that hand's own binding
 * rule (the antagonist review, round 3, 1.4): what "+ New card here" writes.
 *
 * A hand on the map (pinned, or standing in a zone) is a place, and a card for
 * it names it: `place`.
 * A hand that is FOR something it binds (the conversation kit's "Talking to
 * Gareth" chooses `npc: gareth`; a standalone hand's rule binds `area: docks`)
 * takes that group's tag instead, which is the kit's own convention: the topic
 * joins Gareth's conversations wherever they are dealt, and Group by npc files
 * it under Gareth rather than under Untagged. A hand with neither, or one whose
 * only binding is filled from a property, is named by its place, as before.
 */
function tagsToComeUpAt(session: ProjectSession, box: SourceBox, hand: Hand<string>): Record<string, string[]> {
  const map = box.box.box.usesMap === true ? session.loaded.source!.map : undefined;
  if (map !== undefined && (mapSites(box)[hand.id] !== undefined || bindingsOfHand(axisBox(box), hand).has(map.group.id))) {
    return { [PLACE_GROUP]: [hand.id] };
  }
  // Its own bindings (an instance's chosen, a standalone hand's rule), not a
  // template's fixed ones: those are every instance's alike, and leave a card
  // that omits them free to come up at all of them.
  const own = hand.template !== undefined ? hand.chosen : hand.rule?.bindings;
  const groups = groupsOfBox(axisMap(session.loaded.source!), { tagGroups: box.tags.groups, ...(box.box.box.usesMap === true ? { usesMap: true as const } : {}) });
  const tags: Record<string, string[]> = {};
  for (const [group, tag] of Object.entries(own ?? {})) {
    if (group === PLACE_GROUP || isHoleRef(tag)) continue;
    if (groups.some((g) => g.id === group && g.tags.some((t) => t.id === tag))) tags[group] = [tag];
  }
  return Object.keys(tags).length > 0 ? tags : { [PLACE_GROUP]: [hand.id] };
}

export async function duplicateCard(session: ProjectSession, deckId: string, cardId: string): Promise<{ result: OpenResult; cardId: string } | { error: string }> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  const idx = found.deck.shard.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return gone("card");
  const original = found.deck.shard.cards[idx]!;
  const clone = JSON.parse(JSON.stringify(original)) as Card<string>;
  clone.id = newId("c");
  stampOrder(clone.outcomes);
  for (const o of clone.outcomes) o.id = newId("o");
  // Site a distinct gameId so the copy never collides, and mark the title.
  const taken = allCardGameIds(session);
  clone.gameId = dedupedGameId(effectiveGameId(original), taken);
  if (clone.title !== undefined) clone.title = `${clone.title} (copy)`;
  found.deck.shard.cards.splice(idx + 1, 0, clone);
  return commitMaking(session, "Duplicate card", freshKey(), [deckWrite(session, found.deck)], { cardId: clone.id });
}

export async function moveCard(session: ProjectSession, deckId: string, cardId: string, targetId: string, before: boolean): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  // Storage stays id-sorted; reorder writes only the moved card's `order` value,
  // set between its new display neighbours (sparse, so one field changes).
  const order = midpointOrder(found.deck.shard.cards, cardId, targetId, before, "card");
  if (typeof order !== "number") return order;
  found.deck.shard.cards.find((c) => c.id === cardId)!.order = order;
  return commit(session, "Reorder cards", freshKey(), [deckWrite(session, found.deck)]);
}

export async function deleteCard(session: ProjectSession, deckId: string, cardId: string): Promise<Written> {
  return deleteCards(session, deckId, [cardId]);
}

/**
 * Delete several cards of one deck as ONE undo step, which is what the
 * confirmation promises (review 2026-10, item 5): one per card was several
 * steps for one gesture. A card that is not in the deck refuses the whole
 * delete rather than recording a step that removes less than was asked.
 */
export async function deleteCards(session: ProjectSession, deckId: string, cardIds: string[]): Promise<Written> {
  return deleteCardsAcross(session, [{ deckId, cardIds }]);
}

/** Cards from one or several decks (a box's Contents can hold a selection
 *  spanning decks), as ONE undo step: every deck is checked before any changes,
 *  then one commit writes them all (review 2026-10). */
export async function deleteCardsAcross(
  session: ProjectSession, groups: { deckId: string; cardIds: string[] }[],
): Promise<Written> {
  const plans: { found: NonNullable<ReturnType<typeof locate>>; doomed: Set<string> }[] = [];
  for (const g of groups) {
    const found = locate(session, g.deckId);
    if (!found) return gone("deck");
    const doomed = new Set(g.cardIds);
    if (doomed.size === 0) continue;
    const here = new Set(found.deck.shard.cards.map((c) => c.id));
    if ([...doomed].some((id) => !here.has(id))) return gone(doomed.size === 1 ? "card" : "set of cards");
    plans.push({ found, doomed });
  }
  const total = plans.reduce((n, p) => n + p.doomed.size, 0);
  if (total === 0) return { error: "no cards to delete" };
  for (const p of plans) p.found.deck.shard.cards = p.found.deck.shard.cards.filter((c) => !p.doomed.has(c.id));
  return commit(session, total === 1 ? "Delete card" : `Delete ${total} cards`, freshKey(),
    plans.map((p) => deckWrite(session, p.found.deck)));
}

// --- the deck's canvas -----------------------------------------------------------

/**
 * Record where cards now sit on a deck's node canvas.
 *
 * The author's arrangement layer, so it touches the box's `.storyletview` sidecar and no
 * content shard at all: nothing a writer reviewing card text will ever see.
 *
 * Undoable, one step per drop. The key is unique rather than shared, because
 * coalescing every drag on a deck into one entry would make Cmd+Z throw away an
 * afternoon of arranging instead of the move just made.
 *
 * A drop that changed nothing plans no write, and then there is nothing to
 * record either: the project does not go dirty because somebody clicked a card.
 */
export async function moveCardsOnCanvas(session: ProjectSession, deckId: string, placements: CardPlacement[]): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  if (!finitePoints(placements)) return refusedNumber;
  const write = planCardPositions(session.loaded.dir, found.box, deckId, placements);
  if (!write) return reload(session);
  return commit(session, "Arrange cards", freshKey("view"), [{ path: write.path, content: write.content }]);
}

/**
 * A new card, placed where the author asked for it on a canvas.
 *
 * ONE commit, so it is ONE undo step. Creating the card and then moving it was two
 * writes and therefore two steps, and Cmd+Z left a card behind at the default grid
 * slot, which is not a state the author ever asked for.
 *
 * `pinned` is where the deck's other cards currently sit, which the canvas knows
 * and main does not. Writing them all freezes the layout at the moment the author
 * first arranges anything, and that kills a whole class of surprise: the default
 * grid slot is derived from a card's INDEX, so inserting a card could shift every
 * unplaced card along by one ("it pushed around one of my other cards"). Once
 * everything is placed, nothing can be pushed.
 */
export async function createCardOnCanvas(
  session: ProjectSession, deckId: string, at: { x: number; y: number }, pinned: CardPlacement[],
): Promise<{ result: OpenResult; cardId: string } | { error: string }> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  if (!finitePoints([at, ...pinned])) return refusedNumber;
  const card = newCard(session);
  found.deck.shard.cards.push(card);

  const writes: FileState[] = [deckWrite(session, found.deck)];
  const view = planCardPositions(session.loaded.dir, found.box, deckId, [...pinned, { id: card.id, ...at }]);
  if (view) writes.push({ path: view.path, content: view.content });

  return commitMaking(session, "New card", freshKey(), writes, { cardId: card.id });
}

/**
 * Lay a deck's cards out by dependency and record the result: one commit, so one
 * undo step for the whole tidy.
 *
 * The computation lives HERE rather than in the canvas because ops reaches the
 * filesystem through the compiler, and the renderer never imports ops (bundling
 * it drags node:fs into the browser). The canvas sends what only it knows - which
 * cards, where they currently sit, and how big a card is - and gets back the new
 * positions plus any loops to report.
 */
export async function layoutDeck(
  session: ProjectSession, deckId: string, ids: string[],
  current: CardPlacement[], size: { width: number; height: number; gapX: number; gapY: number },
): Promise<{ result: OpenResult; positions: CardPlacement[]; cycles: string[][] } | { error: string }> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  if (ids.length === 0) return { error: "nothing to lay out" };
  if (!finitePoints(current) || !allFinite(size.width, size.height, size.gapX, size.gapY)) return refusedNumber;

  // Start where the arrangement already is, so a tidy does not also teleport the
  // author's work to the origin.
  const anchor = current.filter((c) => ids.includes(c.id))
    .reduce<CardPlacement | undefined>((best, c) => (!best || c.x < best.x || (c.x === best.x && c.y < best.y) ? c : best), undefined);

  const graph = analyseInfluence(session.loaded.source!);
  const { positions, cycles } = layoutByDependency(ids, graph.edges, {
    ...size,
    origin: { x: anchor?.x ?? 0, y: anchor?.y ?? 0 },
  });

  const write = planCardPositions(session.loaded.dir, found.box, deckId, positions);
  const result = write
    ? await commit(session, "Lay out cards", freshKey(), [{ path: write.path, content: write.content }])
    : reload(session);
  return "error" in result ? result : { result, positions, cycles };
}

/**
 * Record a canvas's frames.
 *
 * ONE mutation for every furniture gesture, taking the whole list, rather than
 * an add/edit/move/remove family. The list is short and the renderer already
 * holds it to draw it, so a patch API would be four times the surface for a
 * write that ends up rewriting the same array either way (ops/view.ts says why
 * furniture is written whole).
 *
 * The caller names the gesture, because the caller is the only one who knows
 * whether this was a drag (coalescing, one undo step for the whole sweep) or a
 * discrete command like a colour change. The same rule the backgrounds learnt.
 */
export async function setCanvasFurniture(
  session: ProjectSession, boxId: string, ref: CanvasRef,
  furniture: CanvasFurniture, label: string, coalesce?: string,
): Promise<Written> {
  // The project map's frames are the project's, so its page names no box
  // (`boxId` ""): any box will do as the reader's handle, since a map ref reads
  // and writes the root map shard and never the box (ops view.ts).
  const box = boxId === "" && ref.kind === "map" ? session.loaded.source!.boxes[0] : locateBox(session, boxId);
  if (!box) return gone("box");
  if (!(furniture.frames ?? []).every((f) => allFinite(f.x, f.y, f.w, f.h) && (f.z === undefined || allFinite(f.z)))) return refusedNumber;
  const writes = planCanvasFurniture(session.loaded.dir, box, ref, furniture, session.loaded.source);
  if (writes.length === 0) return reload(session);   // nothing moved: no file touched, no undo step
  return commit(session, label, coalesce ?? freshKey(),
    writes.map((w) => ({ path: w.path, content: w.content })));
}
