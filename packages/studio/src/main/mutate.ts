// ---------------------------------------------------------------------------
// Card mutations: edit the source shard model, write it back CANONICALLY
// through the VC layer (lock-aware; files are the truth), then re-load and
// re-validate. Everything the editor changes goes through this one path, so
// hand edits and editor edits are the same legitimate path through the same
// validator (Reboot 9.2).
// ---------------------------------------------------------------------------

import { basename, join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { SourceBox, SourceDeck } from "@storylet-studio/compiler";
import {
  analyseInfluence, ASSETS_DIR, freeAssetName, imageSize, isSafeAssetName, layoutByDependency, mapSites, newId,
  planCanvasFurniture, planCardPositions, planComments, planForgetSites, planMapSites, proposeCoverage, runNewBox,
  boxFolderWrites,
} from "@storylet-studio/ops";
import type { CanvasRef, CardPlacement } from "@storylet-studio/ops";

/** A pin's new home on the map. Where it is; which zone that turns out to be is
 *  worked out here, not asked for. */
export interface MapSiteMove { id: string; x: number; y: number }

/** A hand whose zone changed as a side effect: `zone` null means it now sits in
 *  none, which for a hand that needs one is an error the Problems bar will name. */
export interface SiteRebinding { id: string; zone: string | null }

/**
 * THE rule of the map: a pinned hand belongs to the zone its pin is standing in.
 *
 * Applied after either side of that sentence changes - the pin moved, or the
 * zones did - so the two can never drift apart. That is why it is one function
 * called from three places rather than a rule the canvas applies on drops: an
 * outline dragged over a pin has moved that hand just as surely as dragging the
 * pin would have, and a map where those two gestures disagree is a map that
 * cannot be trusted.
 *
 * A hand whose pin ends up outside every zone is left LOOSE: its binding is
 * cleared rather than quietly kept. If that hand needs a zone the compiler says
 * so ("missing chosen tag ... a hand is fully concrete") and the author sees an
 * error, which is the honest outcome; keeping the old zone would leave the map
 * asserting something no longer true and nothing anywhere saying so.
 *
 * Only PINNED hands are governed. A hand nobody has placed has no position and
 * therefore no opinion, and must keep the binding it was given elsewhere.
 * Bindings that belong to a template are never touched (see `bindHand`).
 *
 * `positions` overrides what the sidecar holds, for the caller that is in the
 * middle of moving sites and has not written them yet.
 */
function bindSitesToZones(
  box: SourceBox, groupId: string, positions?: Record<string, { x: number; y: number }>,
): SiteRebinding[] {
  const group = box.tags.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const zones: { id: string; polygon: Polygon; z?: number }[] = [];
  for (const tag of group.tags) {
    const polygon = polygonOf(tag);
    const z = zOf(tag);
    if (polygon) zones.push({ id: tag.id, polygon, ...(z !== undefined ? { z } : {}) });
  }
  const sites = { ...mapSites(box), ...positions };

  const changed: SiteRebinding[] = [];
  for (const hand of box.hands.hands) {
    const at = sites[hand.id];
    if (!at) continue;
    const template = box.hands.templates.find((t) => t.id === hand.template);
    const binding = handBinding(hand, template, groupId);
    if (!binding.editable) continue;
    const zone = zoneAt(at, zones) ?? null;
    if (zone === (binding.tag ?? null)) continue;
    const moved = zone === null
      ? unbindHand(hand, template, groupId)
      : bindHand(hand, template, groupId, zone);
    if (moved) changed.push({ id: hand.id, zone });
  }
  return changed;
}
import {
  DECK_SCHEMA, PLACE_GROUP, SHARD_EXTENSIONS, backgroundsOf, bindHand, droppedRect, effectiveGameId, freeGameId, freeTitle, isValidGameId, gameIdify,
  handBinding, isSpatial, polygonOf, restack, unbindHand, withBackgrounds, withPolygon, withSpatialGroup, withZ,
  zOf, zoneAt,
} from "@storylet-studio/model";
import type {
  BoxShard, CoverageConfig, CoverageDriver, Hand, HandsShard, HandTemplate, Polygon, ProjectShard, PropertyDecl,
  SpatialBackground, StackMove, Tag, TagGroup, TagsShard } from "@storylet-studio/model";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { applyStates, captureBefore } from "./history.js";
import type { FileState } from "./history.js";
import { commentsOf } from "@storylet-studio/model";
import type { CanvasFurniture, Card, Comment, CommentMark, DeckShard, Outcome, RedrawPolicy, ScalarValue } from "@storylet-studio/model";
import { MAP_CANVAS } from "../shared/api.js";
import type { BindingDto, BoxEdit, BoxKit, CardEdit, ConditionProperty, CoverageDriverDto, DeckEdit, HandDetail, HandEdit, ProjectSettingsDto, PropertyDeclDto, TagGroupDetail, TagGroupEdit, TemplateDetail, TemplateEdit } from "../shared/api.js";
import type { ProjectSession } from "./project.js";
import { byDisplay, toDto } from "./project.js";
import { validate } from "./project.js";
import type { OpenResult } from "../shared/api.js";
import { openResult } from "./project.js";

interface Located {
  box: SourceBox;
  deck: SourceDeck;
}

function locate(session: ProjectSession, deckId: string): Located | undefined {
  for (const box of session.loaded.source!.boxes) {
    const deck = box.decks.find((d) => d.shard.deck.id === deckId);
    if (deck) return { box, deck };
  }
  return undefined;
}

/**
 * Every card gameId in the PROJECT, which is the scope they have to be unique in.
 *
 * Card gameIds are project-wide addresses: the play-history functions key on them
 * (compile.ts, "global uniqueness"). Both creating and duplicating a card used to
 * dedupe against the cards in ONE DECK, so a second "New card" in a second deck
 * produced a duplicate gameId and a validation error. Easy to miss until making
 * cards became easy - the canvas's "New card here" hit it immediately.
 */
function allCardGameIds(session: ProjectSession): Set<string> {
  const taken = new Set<string>();
  for (const box of session.loaded.source!.boxes) {
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) taken.add(effectiveGameId(card));
    }
  }
  return taken;
}

const blank = (src: string | undefined): boolean => src === undefined || src.trim() === "";

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
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) next.gameId = g; else delete next.gameId; }
  if (edit.title !== undefined) { if (edit.title.trim()) next.title = edit.title; else delete next.title; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) next.purpose = edit.purpose; else delete next.purpose; }
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
  if (edit.fields !== undefined) {
    const fields: Record<string, ScalarValue> = {};
    for (const { name, value } of edit.fields) fields[name] = coerceField(value);
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
      return outcome;
    });
  }
  return next;
}

// Cards are stored id-sorted (Reboot 7.4: id-sorted storage keeps the merge
// order-free) and display order rides in each card's `order` field. The sort
// is the canonical serialiser's (compiler `canonicalStringify`, source rule 6),
// so the editor, the CLI and the merge cannot disagree about it.
const deckContent = (deck: SourceDeck): string => canonicalStringify(deck.shard satisfies DeckShard);

/**
 * Pin the current array order into each item's `order`.
 *
 * For DUPLICATION specifically. The serialiser stamps a missing `order` from
 * position, but only when it has to sort; a cloned list whose fresh ids happen
 * to land in id order is left alone, and then displays in the order of ids it
 * only just drew rather than the order it was copied from. Stamping before the
 * ids change makes the copy look like the original whatever it draws.
 */
const stampOrder = (items: { order?: number }[]): void => {
  items.forEach((x, i) => { x.order = i; });
};

let structCounter = 0;

/** Apply a set of file writes, recording an undo entry, then reload. `key`
 *  coalesces consecutive same-key edits into one undo step; pass a unique key
 *  for a standalone (structural) change. Exported for the project-wide
 *  Replace (replace.ts), which is the same path with more files in it. */
export function commit(session: ProjectSession, label: string, key: string, writes: FileState[]): OpenResult | { error: string } {
  const before = captureBefore(writes.map((w) => w.path));
  if (!applyStates(writes)) return { error: "could not write (locked or read-only?)" };
  session.history.record(label, key, before, writes);
  return reload(session);
}


/** Live Link: told after every write that lands through here (a commit, an
 *  undo, a redo), so a connected game can be refreshed. One listener; main
 *  sets it. */
let onWritten: (() => void) | undefined;
export function setProjectWrittenListener(fn: (() => void) | undefined): void { onWritten = fn; }

/** Reload + revalidate after a write, so DTOs and problems are fresh. */
function reload(session: ProjectSession): OpenResult {
  const result = openResult(session, validate(session));
  onWritten?.();
  return result;
}

const deckFileState = (session: ProjectSession, deck: SourceDeck, content: string | null): FileState =>
  ({ path: join(session.loaded.dir, deck.path), content });

export function saveCard(session: ProjectSession, deckId: string, cardId: string, edit: CardEdit): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const index = found.deck.shard.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return { error: `unknown card (id ${cardId})` };
  const updated = applyEdit(found.box, found.deck.shard.cards[index]!, edit);
  found.deck.shard.cards[index] = updated;
  // Consecutive edits to one card coalesce into a single undo step.
  return commit(session, `Edit ${updated.gameId}`, `card:${cardId}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
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

export function createCard(session: ProjectSession, deckId: string): { result: OpenResult; cardId: string } | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  // No pinned gameId: it derives from the title, so it follows the first
  // real title the author types (never a stuck "new-card"). Dedupe the
  // placeholder title so freshly-made cards start valid and unique.
  const card = newCard(session);
  found.deck.shard.cards.push(card);
  const result = commit(session, "New card", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
  return "error" in result ? result : { result, cardId: card.id };
}

export function duplicateCard(session: ProjectSession, deckId: string, cardId: string): { result: OpenResult; cardId: string } | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const idx = found.deck.shard.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return { error: `unknown card (id ${cardId})` };
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
  const result = commit(session, "Duplicate card", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
  return "error" in result ? result : { result, cardId: clone.id };
}

export function moveCard(session: ProjectSession, deckId: string, cardId: string, targetId: string, before: boolean): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  // Storage stays id-sorted; reorder writes only the moved card's `order` value,
  // set between its new display neighbours (sparse, so one field changes).
  const withOrder = found.deck.shard.cards.map((c, i) => ({ c, o: c.order ?? i }));
  const card = withOrder.find((x) => x.c.id === cardId)?.c;
  if (!card) return { error: `unknown card (id ${cardId})` };
  const others = withOrder.filter((x) => x.c.id !== cardId).sort((a, b) => a.o - b.o);
  const ti = others.findIndex((x) => x.c.id === targetId);
  if (ti < 0) return { error: "drop target not found" };
  const targetO = others[ti]!.o;
  card.order = before
    ? ((ti > 0 ? others[ti - 1]!.o : targetO - 2) + targetO) / 2
    : (targetO + (ti < others.length - 1 ? others[ti + 1]!.o : targetO + 2)) / 2;
  return commit(session, "Reorder cards", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
}

/** The reorder rule shared by every mover (cards pioneered it): storage
 *  order is untouched; only the moved item gains a sparse `order` set
 *  between its new display neighbours. */
function midpointOrder(items: { id: string; order?: number }[], movedId: string, targetId: string, before: boolean): number | { error: string } {
  const withOrder = items.map((c, i) => ({ c, o: c.order ?? i }));
  if (!withOrder.some((x) => x.c.id === movedId)) return { error: `unknown item (id ${movedId})` };
  const others = withOrder.filter((x) => x.c.id !== movedId).sort((a, b) => a.o - b.o);
  const ti = others.findIndex((x) => x.c.id === targetId);
  if (ti < 0) return { error: "drop target not found" };
  const targetO = others[ti]!.o;
  return before
    ? ((ti > 0 ? others[ti - 1]!.o : targetO - 2) + targetO) / 2
    : (targetO + (ti < others.length - 1 ? others[ti + 1]!.o : targetO + 2)) / 2;
}

/**
 * Record where cards now sit on a deck's node canvas.
 *
 * The arrangement layer, so it touches the box's `.storyletview` sidecar and no
 * content shard at all: nothing a writer reviewing card text will ever see.
 *
 * Undoable, one step per drop. The key is unique rather than shared, because
 * coalescing every drag on a deck into one entry would make Cmd+Z throw away an
 * afternoon of arranging instead of the move just made.
 *
 * A drop that changed nothing plans no write, and then there is nothing to
 * record either: the project does not go dirty because somebody clicked a card.
 */
export function moveCardsOnCanvas(session: ProjectSession, deckId: string, placements: CardPlacement[]): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const write = planCardPositions(session.loaded.dir, found.box, deckId, placements);
  if (!write) return reload(session);
  return commit(session, "Arrange cards", `view:${structCounter++}`, [{ path: write.path, content: write.content }]);
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
export function createCardOnCanvas(
  session: ProjectSession, deckId: string, at: { x: number; y: number }, pinned: CardPlacement[],
): { result: OpenResult; cardId: string } | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const card = newCard(session);
  found.deck.shard.cards.push(card);

  const writes: FileState[] = [deckFileState(session, found.deck, deckContent(found.deck))];
  const view = planCardPositions(session.loaded.dir, found.box, deckId, [...pinned, { id: card.id, ...at }]);
  if (view) writes.push({ path: view.path, content: view.content });

  const result = commit(session, "New card", `struct:${structCounter++}`, writes);
  return "error" in result ? result : { result, cardId: card.id };
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
export function layoutDeck(
  session: ProjectSession, deckId: string, ids: string[],
  current: CardPlacement[], size: { width: number; height: number; gapX: number; gapY: number },
): { result: OpenResult; positions: CardPlacement[]; cycles: string[][] } | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  if (ids.length === 0) return { error: "nothing to lay out" };

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
    ? commit(session, "Lay out cards", `struct:${structCounter++}`, [{ path: write.path, content: write.content }])
    : reload(session);
  return "error" in result ? result : { result, positions, cycles };
}

export function moveBox(session: ProjectSession, boxId: string, targetId: string, before: boolean): OpenResult | { error: string } {
  const boxes = session.loaded.source!.boxes;
  const order = midpointOrder(boxes.map((b) => b.box.box), boxId, targetId, before);
  if (typeof order !== "number") return order;
  const moved = boxes.find((b) => b.box.box.id === boxId)!;
  moved.box.box.order = order;
  return commit(session, "Reorder boxes", `struct:${structCounter++}`,
    [{ path: boxFile(session, moved), content: canonicalStringify(moved.box) }]);
}

export function moveDeck(session: ProjectSession, deckId: string, targetId: string, before: boolean): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const order = midpointOrder(found.box.decks.map((d) => d.shard.deck), deckId, targetId, before);
  if (typeof order !== "number") return order;
  found.deck.shard.deck.order = order;
  return commit(session, "Reorder decks", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
}

export function moveHand(session: ProjectSession, boxId: string, handId: string, targetId: string, before: boolean): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const order = midpointOrder(box.hands.hands, handId, targetId, before);
  if (typeof order !== "number") return order;
  box.hands.hands.find((h) => h.id === handId)!.order = order;
  return commit(session, "Reorder hands", `struct:${structCounter++}`,
    [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
}

export function deleteCard(session: ProjectSession, deckId: string, cardId: string): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  found.deck.shard.cards = found.deck.shard.cards.filter((c) => c.id !== cardId);
  return commit(session, "Delete card", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, deckContent(found.deck))]);
}

// --- deck lifecycle -------------------------------------------------------------

function locateBox(session: ProjectSession, boxId: string): SourceBox | undefined {
  return session.loaded.source!.boxes.find((b) => b.box.box.id === boxId);
}

/**
 * Where a deck's shard lives: its box's `decks/`, named by its effective gameId.
 *
 * The gameId is CHECKED here and not merely reported by validate, because this
 * is the boundary where a bad one stops being a confusing name and becomes a
 * write. `join` resolves "..", so a shard hand-edited to carry
 * `gameId: "../../../tmp/evil"` would have this write outside the project
 * entirely - and it reaches here without passing through the editor's coercion,
 * because renaming a deck's TITLE leaves the pinned gameId untouched and hands
 * it straight to the path.
 *
 * The editor cannot produce one (every save runs `gameIdify`), so throwing is
 * right: this is not a state a person can talk themselves into, it is a
 * corrupted or hostile shard, and the caller has no better answer than refusing.
 */
const deckPath = (session: ProjectSession, box: SourceBox, gameId: string): string => {
  if (!isValidGameId(gameId)) {
    throw new Error(`refusing to write a deck named "${gameId}": that is not a legal address`);
  }
  return join(session.loaded.dir, box.path, "decks", `${gameId}${SHARD_EXTENSIONS.deck}`);
};

export function createDeck(session: ProjectSession, boxId: string): { result: OpenResult; deckId: string } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const taken = new Set(box.decks.map((d) => effectiveGameId(d.shard.deck)));
  const title = freeTitle("New deck", taken);
  const shard: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title, properties: [] },
    cards: [],
  };
  const result = commit(session, "New deck", `struct:${structCounter++}`,
    [{ path: deckPath(session, box, effectiveGameId(shard.deck)), content: canonicalStringify(shard) }]);
  return "error" in result ? result : { result, deckId: shard.deck.id };
}

// Kits (Blank / RPG) live in ops (runNewBox), so the CLI's `new box --kit`
// and this editor scaffold the identical box: one core, many front-ends.
export function createBox(session: ProjectSession, kit: BoxKit = "blank"): { result: OpenResult; boxId: string } | { error: string } {
  try {
    const planned = runNewBox({ loaded: session.loaded, kit });
    const result = commit(session, "New box", `struct:${structCounter++}`,
      planned.writes.map((w): FileState => ({ path: w.path, content: w.content })));
    return "error" in result ? result : { result, boxId: planned.boxId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Delete a whole box: every shard in its folder, in one undoable step (the
 *  file-state history holds the before-images, so Cmd+Z restores it all).
 *  The renderer confirms first - this is the big red switch. */
export function deleteBox(session: ProjectSession, boxId: string): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const writes: FileState[] = [
    { path: boxFile(session, box), content: null },
    { path: tagsFile(session, box), content: null },
    { path: handsFile(session, box), content: null },
    ...box.decks.map((d) => ({ path: join(session.loaded.dir, d.path), content: null })),
  ];
  return commit(session, "Delete box", `struct:${structCounter++}`, writes);
}

/** Duplicate a whole box: a new folder, fresh ids THROUGHOUT with every
 *  cross-reference remapped (bindings, chosen, card tags, home hands,
 *  template pointers), deduped gameId, "(copy)" title. */
export function duplicateBox(session: ProjectSession, boxId: string): { result: OpenResult; boxId: string } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };

  // One id map for the whole box; anything unknown passes through (the
  // reserved "place" key, and any dangling reference validate already flags).
  const idMap = new Map<string, string>();
  const fresh = (old: string, prefix: string): string => {
    const next = newId(prefix);
    idMap.set(old, next);
    return next;
  };
  const mapped = (id: string): string => idMap.get(id) ?? id;
  const remapRecord = (r: Record<string, string> | undefined): Record<string, string> | undefined =>
    r === undefined ? undefined : Object.fromEntries(Object.entries(r).map(([k, v]) => [mapped(k), mapped(v)]));

  const src = {
    box: JSON.parse(JSON.stringify(box.box)) as BoxShard,
    tags: JSON.parse(JSON.stringify(box.tags)) as TagsShard,
    hands: JSON.parse(JSON.stringify(box.hands)) as HandsShard,
    decks: box.decks.map((d) => JSON.parse(JSON.stringify(d.shard)) as DeckShard),
  };

  // Pass 0: pin display order before any id changes. Every collection below
  // is id-sorted in storage, and every id in the copy is about to be replaced,
  // so without this the copy is ordered by ids it has not drawn yet.
  stampOrder(src.tags.groups);
  for (const group of src.tags.groups) stampOrder(group.tags);
  stampOrder(src.hands.templates);
  stampOrder(src.hands.hands);
  for (const deck of src.decks) { stampOrder(deck.cards); for (const card of deck.cards) stampOrder(card.outcomes); }

  // Pass 1: fresh ids for every entity (so forward references resolve).
  const newBoxId = fresh(src.box.box.id, "b");
  for (const group of src.tags.groups) { fresh(group.id, "d"); for (const tag of group.tags) fresh(tag.id, "v"); }
  for (const template of src.hands.templates) fresh(template.id, "t");
  for (const hand of src.hands.hands) fresh(hand.id, "h");
  for (const deck of src.decks) {
    fresh(deck.deck.id, "k");
    for (const card of deck.cards) { fresh(card.id, "c"); for (const o of card.outcomes) fresh(o.id, "o"); }
  }

  // Pass 2: apply ids + remap every cross-reference.
  src.box.box.id = newBoxId;
  const taken = new Set(session.loaded.source!.boxes.map((b) => effectiveGameId(b.box.box)));
  src.box.box.gameId = dedupedGameId(effectiveGameId(box.box.box), taken);
  if (src.box.box.title !== undefined) src.box.box.title = `${src.box.box.title} (copy)`;
  for (const group of src.tags.groups) { group.id = mapped(group.id); for (const tag of group.tags) tag.id = mapped(tag.id); }
  for (const template of src.hands.templates) {
    template.id = mapped(template.id);
    if (template.bindings !== undefined) template.bindings = remapRecord(template.bindings)!;
    if (template.chooses !== undefined) template.chooses = template.chooses.map(mapped);
  }
  // Hand gameIds are API, project-wide unique (deal() is called by name):
  // every cloned hand gets a deduped name, like a single-hand duplicate.
  const handNames = new Set(session.loaded.source!.boxes.flatMap((b) => b.hands.hands.map((h) => effectiveGameId(h))));
  for (const hand of src.hands.hands) {
    hand.id = mapped(hand.id);
    if (hand.template !== undefined) hand.template = mapped(hand.template);
    if (hand.chosen !== undefined) hand.chosen = remapRecord(hand.chosen)!;
    if (hand.rule?.bindings !== undefined) hand.rule.bindings = remapRecord(hand.rule.bindings)!;
    hand.gameId = dedupedGameId(effectiveGameId(hand), handNames);
    handNames.add(hand.gameId);
  }
  // Card gameIds are project-wide too (the play log speaks them): dedupe.
  const cardNames = new Set(session.loaded.source!.boxes.flatMap((b) =>
    b.decks.flatMap((d) => d.shard.cards.map((c) => effectiveGameId(c)))));
  for (const deck of src.decks) {
    deck.deck.id = mapped(deck.deck.id);
    for (const card of deck.cards) {
      card.id = mapped(card.id);
      for (const o of card.outcomes) o.id = mapped(o.id);
      if (card.tags !== undefined) {
        card.tags = Object.fromEntries(Object.entries(card.tags).map(([groupId, tagIds]) =>
          [groupId === PLACE_GROUP ? PLACE_GROUP : mapped(groupId), tagIds.map(mapped)]));
      }
      card.gameId = dedupedGameId(effectiveGameId(card), cardNames);
      cardNames.add(card.gameId);
    }
  }

  // The same plan runNewBox uses: one box is four files in a folder, and the
  // rule for the folder's NAME lives with it (the two had drifted).
  const writes: FileState[] = boxFolderWrites(session.loaded.dir, {
    box: src.box, tags: src.tags, hands: src.hands, decks: src.decks,
  });
  const result = commit(session, "Duplicate box", `struct:${structCounter++}`, writes);
  return "error" in result ? result : { result, boxId: newBoxId };
}

export function deleteDeck(session: ProjectSession, deckId: string): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  if (found.deck.shard.cards.length > 0) {
    return { error: "delete the deck's cards first (a non-empty deck is not removed by accident)" };
  }
  return commit(session, "Delete deck", `struct:${structCounter++}`,
    [deckFileState(session, found.deck, null)]);
}

export function renameDeck(session: ProjectSession, deckId: string, edit: DeckEdit): OpenResult | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  // The deck's address names its FILE, and this is the one edit that can reach
  // the write with a gameId the editor never sanitised: renaming only the TITLE
  // leaves a pinned gameId untouched, so a shard that arrived from somewhere
  // else (hand-edited, unpacked, merged) carries whatever it carries. Said
  // plainly here; deckPath refuses as a backstop.
  const pinnedNow = found.deck.shard.deck.gameId?.trim();
  if (pinnedNow !== undefined && pinnedNow !== "" && !isValidGameId(pinnedNow)) {
    return { error: `this deck's gameId "${pinnedNow}" is not a legal address, so it cannot be saved under it. Fix the gameId first.` };
  }
  const oldPath = join(session.loaded.dir, found.deck.path);
  const oldEffective = effectiveGameId(found.deck.shard.deck);
  if (edit.title !== undefined) {
    if (edit.title.trim()) found.deck.shard.deck.title = edit.title;
    else delete found.deck.shard.deck.title;
  }
  if (edit.gameId !== undefined) {
    const g = gameIdify(edit.gameId);
    if (g) found.deck.shard.deck.gameId = g; else delete found.deck.shard.deck.gameId;
  }
  if (edit.purpose !== undefined) {
    if (edit.purpose.trim()) found.deck.shard.deck.purpose = edit.purpose;
    else delete found.deck.shard.deck.purpose;
  }
  if (edit.gate !== undefined) {
    if (blank(edit.gate)) delete found.deck.shard.deck.condition;
    else found.deck.shard.deck.condition = edit.gate;
  }
  if (edit.shared !== undefined) {
    // Written only when true: absent is the default and keeps the shard quiet.
    if (edit.shared) found.deck.shard.deck.shared = true;
    else delete found.deck.shard.deck.shared;
  }
  if (edit.properties !== undefined) {
    found.deck.shard.deck.properties = edit.properties.filter((d) => d.name.trim()).map(declFromDto);
  }

  // The file name tracks the deck's EFFECTIVE gameId (pinned, or derived from
  // the title), so a rename never leaves the drift validate would warn about.
  const newEffective = effectiveGameId(found.deck.shard.deck);
  const moved = newEffective !== oldEffective;
  const content = canonicalStringify(found.deck.shard);
  const writes: FileState[] = moved
    ? [{ path: deckPath(session, found.box, newEffective), content }, { path: oldPath, content: null }]
    : [{ path: oldPath, content }];
  return commit(session, "Rename deck", `rename:${deckId}`, writes);
}

// --- undo / redo ----------------------------------------------------------------

export function undo(session: ProjectSession): OpenResult | null {
  const states = session.history.undo();
  if (!states) return null;
  applyStates(states);
  return reload(session);
}

export function redo(session: ProjectSession): OpenResult | null {
  const states = session.history.redo();
  if (!states) return null;
  applyStates(states);
  return reload(session);
}

// --- coverage drivers (the "add drivers" quick-fix) -----------------------------

/** Propose coverage drivers from the conditions and merge them into the
 *  project shard (existing author config wins). Undoable; returns the refs
 *  added. */
export function saveProjectSettings(session: ProjectSession, dto: ProjectSettingsDto): OpenResult | { error: string } {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  const p = source.project;
  p.project.name = dto.name;
  p.project.version = dto.version;
  p.world.properties = dto.world.filter((d) => d.name.trim()).map(declFromDto);
  p.story.properties = dto.story.filter((d) => d.name.trim()).map(declFromDto);
  p.export.bundle = dto.bundlePath;
  p.export.metadata = dto.metadata;
  // Off is the default, so off is written as ABSENT rather than as `false`: a
  // shard says what an author chose, and a key nobody set is noise in a diff.
  if (dto.exportMap) p.export.map = true; else delete p.export.map;
  if (dto.warnUnreadWrites) p.validation = { warnUnreadWrites: true }; else delete p.validation;
  p.settings.playAdvancesTurns = dto.playAdvancesTurns;
  writeDrivers(p, dto.drivers);
  const path = join(session.loaded.dir, source.path);
  return commit(session, "Project settings", `struct:${structCounter++}`,
    [{ path, content: canonicalStringify(source.project) }]);
}

/** Fold the edited driver list back into the shard's map. A driver with no
 *  property name or an empty pool is inert, so a half-typed row is dropped
 *  rather than written; a repeated ref keeps the last one, matching what the
 *  editor's duplicate guard has already flagged. */
function writeDrivers(p: ProjectShard, dtos: CoverageDriverDto[]): void {
  const drivers: Record<string, CoverageDriver> = {};
  for (const d of dtos) {
    const ref = d.ref.trim();
    if (ref === "" || ref.endsWith(".") || d.values.length === 0) continue;
    drivers[ref] = {
      kind: d.kind,
      ...(d.kind === "recurring" ? { cadence: d.cadence ?? "sometimes" } : {}),
      values: [...d.values],
    };
  }
  if (Object.keys(drivers).length > 0) {
    p.coverage = { ...p.coverage, drivers };
  } else if (p.coverage) {
    delete p.coverage.drivers;
    // Removing the last driver removes the block, rather than leaving an
    // empty `coverage: {}` behind in the shard.
    if (Object.keys(p.coverage).length === 0) delete p.coverage;
  }
}

/** "Propose from story" in the settings dialog: the auto-proposal WITHOUT
 *  writing it, so the author can prune it before the dialog saves. */
export function proposeDrivers(session: ProjectSession): CoverageDriverDto[] {
  const source = session.loaded.source;
  if (!source) return [];
  const { coverage } = proposeCoverage(source);
  return Object.entries(coverage.drivers ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([ref, d]) => ({
    ref, kind: d.kind, ...(d.cadence !== undefined ? { cadence: d.cadence } : {}), values: [...d.values],
  }));
}

export function addCoverageDrivers(session: ProjectSession): { result: OpenResult; added: string[] } | { error: string } {
  const source = session.loaded.source!;
  const { coverage } = proposeCoverage(source);
  const existing = source.project.coverage ?? {};
  const mergedDrivers = { ...(coverage.drivers ?? {}), ...(existing.drivers ?? {}) };
  const added = Object.keys(coverage.drivers ?? {}).filter((ref) => !(existing.drivers ?? {})[ref]);

  const merged: CoverageConfig = {};
  if (Object.keys(mergedDrivers).length > 0) merged.drivers = mergedDrivers;
  source.project.coverage = merged;

  const path = join(session.loaded.dir, source.path);
  const result = commit(session, "Add coverage drivers", `struct:${structCounter++}`,
    [{ path, content: canonicalStringify(source.project) }]);
  return "error" in result ? result : { result, added };
}

/** The expr-editor catalogue reachable from a card in this deck: the five
 *  scopes' declared properties. @hand is composed per deal, so its entries
 *  are the superset of dimension-value properties and query params in the
 *  box (authoring assist; validate remains the real check). */
export function cardCatalogue(session: ProjectSession, deckId: string): ConditionProperty[] {
  const found = locate(session, deckId);
  if (!found) return [];
  return catalogueFor(session, found.box, found.deck);
}

/** The box-scoped catalogue (no @deck feeder): query conditions and other
 *  box-level expressions edit against this. */
export function boxCatalogue(session: ProjectSession, boxId: string): ConditionProperty[] {
  const box = locateBox(session, boxId);
  return box ? catalogueFor(session, box, undefined) : [];
}

function catalogueFor(session: ProjectSession, box: SourceBox, deck: SourceDeck | undefined): ConditionProperty[] {
  const project = session.loaded.source!.project;
  const out: ConditionProperty[] = [];
  const add = (scope: string, decls: { name: string; type: string; values?: string[]; stages?: string[]; writable?: boolean; purpose?: string }[]): void => {
    for (const d of decls) {
      out.push({
        scope, name: d.name, type: d.type as ConditionProperty["type"],
        ...(d.values !== undefined ? { enumValues: d.values } : {}),
        // A quality's ladder, without which expr-editor can offer the property
        // and then no stage to compare it against (expr-editor 0.11.0).
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
        ...(d.writable !== undefined ? { writable: d.writable } : {}),
        ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
      });
    }
  };
  add("world", project.world?.properties ?? []);
  add("story", project.story?.properties ?? []);
  add("box", box.box.box.properties ?? []);
  if (deck) add("deck", deck.shard.deck.properties ?? []);
  const handNames = new Set<string>();
  for (const group of box.tags.groups) {
    // GROUP-level declarations first: the compiler flattens these onto every
    // tag (the patrolled pattern - declared once, set per tag), so
    // @hand.<name> is a legal read. Feeding only per-tag declarations left
    // the expression editor calling a compiling reference unknown - an error
    // pill on the card with nothing in the problems bar to explain it.
    for (const p of group.properties ?? []) {
      if (!handNames.has(p.name)) { handNames.add(p.name); add("hand", [p]); }
    }
    for (const tag of group.tags) {
      for (const p of tag.properties ?? []) {
        if (!handNames.has(p.name)) { handNames.add(p.name); add("hand", [p]); }
      }
    }
  }
  // @hand composes tag props -> hand props -> chosen tags / criteria by
  // group name (schema 3.6), so the catalogue offers all three feeders.
  for (const hand of box.hands.hands) {
    for (const p of hand.properties ?? []) {
      if (!handNames.has(p.name)) { handNames.add(p.name); add("hand", [p]); }
    }
  }
  for (const template of box.hands.templates) {
    for (const p of template.properties ?? []) {
      if (!handNames.has(p.name)) { handNames.add(p.name); add("hand", [p]); }
    }
  }
  for (const group of box.tags.groups) {
    const name = effectiveGameId(group);
    // The chosen tag reads as its gameId, so the closed set of values IS the
    // group's tags: an enum, which gets the picker a list to offer and makes a
    // misspelt tag name a fault. The same shape the compiler infers for @hand
    // (design/hand-typing.md step A), so the two cannot disagree.
    if (!handNames.has(name)) {
      handNames.add(name);
      add("hand", [{ name, type: "enum", values: group.tags.map((t) => effectiveGameId(t)) }]);
    }
  }
  return out;
}

export { toDto };
// --- box / query / dimension editing (Phase 3) ----------------------------------

const coerceDefault = (raw: string, type: string): ScalarValue => {
  const t = raw.trim();
  if (type === "boolean") return t === "true";
  if (type === "number") return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : 0;
  if (type === "flags") { try { const v = parseSource(t); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } }
  return t;   // string / enum
};
const declFromDto = (d: PropertyDeclDto): PropertyDecl => ({
  name: d.name, type: d.type as PropertyDecl["type"],
  // A quality with no explicit default starts at its first stage; the compile
  // gate still checks the result is ON the ladder either way.
  default: d.type === "quality" && d.default.trim() === "" ? (d.stages?.[0] ?? "") : coerceDefault(d.default, d.type),
  ...(d.values !== undefined ? { values: d.values } : {}),
  ...(d.stages !== undefined ? { stages: d.stages } : {}),
  ...(d.writable !== undefined ? { writable: d.writable } : {}),
  // Blank means no purpose: an emptied field deletes rather than storing "".
  ...(d.purpose !== undefined && d.purpose.trim() !== "" ? { purpose: d.purpose.trim() } : {}),
});
const boxFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `box${SHARD_EXTENSIONS.box}`);
const handsFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `hands${SHARD_EXTENSIONS.hands}`);
const tagsFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `tags${SHARD_EXTENSIONS.tags}`);

export function saveBox(session: ProjectSession, boxId: string, edit: BoxEdit): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const b = box.box.box;
  if (edit.title !== undefined) { if (edit.title.trim()) b.title = edit.title; else delete b.title; }
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) b.gameId = g; else delete b.gameId; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) b.purpose = edit.purpose; else delete b.purpose; }
  if (edit.ranking !== undefined) b.ranking = { specificity: edit.ranking.specificity };
  if (edit.fields !== undefined) b.fields = edit.fields.map(declFromDto);
  if (edit.properties !== undefined) b.properties = edit.properties.map(declFromDto);
  return commit(session, "Edit box", `box:${boxId}`, [{ path: boxFile(session, box), content: canonicalStringify(box.box) }]);
}

/** One binding row per tag group: fixed tag, hole, or unbound. */
function bindingRows(box: SourceBox, bindings: Record<string, string> | undefined, chooses: string[] | undefined): BindingDto[] {
  return byDisplay(box.tags.groups).map((group) => {
    const gid = effectiveGameId(group);
    const tagId = bindings?.[group.id];
    if (tagId !== undefined) {
      const tag = group.tags.find((x) => x.id === tagId);
      return { group: gid, value: tag ? effectiveGameId(tag) : tagId };
    }
    if ((chooses ?? []).includes(group.id)) return { group: gid, hole: true };
    return { group: gid };
  });
}

/** Resolve binding rows back to stored form (fixed bindings + chooses). */
function resolveBindingRows(box: SourceBox, rows: BindingDto[]): { bindings: Record<string, string>; chooses: string[] } {
  const bindings: Record<string, string> = {};
  const chooses: string[] = [];
  for (const b of rows) {
    const group = box.tags.groups.find((d) => effectiveGameId(d) === b.group);
    if (!group) continue;
    if (b.hole) { chooses.push(group.id); continue; }
    if (b.value) {
      const tag = group.tags.find((x) => effectiveGameId(x) === b.value);
      if (tag) bindings[group.id] = tag.id;
    }
  }
  return { bindings, chooses };
}

export function templateDetail(session: ProjectSession, boxId: string, templateId: string): TemplateDetail | null {
  const box = locateBox(session, boxId);
  const template = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !template) return null;
  return {
    id: template.id, gameId: effectiveGameId(template),
    ...(template.purpose !== undefined ? { purpose: template.purpose } : {}),
    bindings: bindingRows(box, template.bindings, template.chooses),
    ...(!blank(template.condition) ? { condition: template.condition } : {}),
    slots: String(template.slots ?? "unbounded"),
    properties: (template.properties ?? []).map((p) => ({
      name: p.name, type: p.type, default: typeof p.default === "string" ? p.default : JSON.stringify(p.default),
      ...(p.values !== undefined ? { values: p.values } : {}),
    })),
    groups: byDisplay(box.tags.groups).map((d) => ({ gameId: effectiveGameId(d), values: byDisplay(d.tags).map((v) => effectiveGameId(v)) })),
    instances: box.hands.hands.filter((h) => h.template === template.id).map((h) => h.title ?? effectiveGameId(h)),
  };
}

export function saveTemplate(session: ProjectSession, boxId: string, templateId: string, edit: TemplateEdit): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const template = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !template) return { error: `unknown hand template (id ${templateId})` };
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) template.gameId = g; else delete template.gameId; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) template.purpose = edit.purpose; else delete template.purpose; }
  if (edit.condition !== undefined) { if (blank(edit.condition)) delete template.condition; else template.condition = edit.condition; }
  if (edit.slots !== undefined) template.slots = edit.slots === "unbounded" ? "unbounded" : (Number.isInteger(Number(edit.slots)) && edit.slots.trim() ? Number(edit.slots) : "unbounded");
  if (edit.properties !== undefined) template.properties = edit.properties.filter((d) => d.name.trim()).map(declFromDto);
  if (edit.bindings !== undefined) {
    const { bindings, chooses } = resolveBindingRows(box, edit.bindings);
    if (Object.keys(bindings).length > 0) template.bindings = bindings; else delete template.bindings;
    if (chooses.length > 0) template.chooses = chooses; else delete template.chooses;
    // A hole change reshapes every instance: drop chosen entries for groups
    // that are no longer holes (instances stay fully concrete).
    for (const hand of box.hands.hands) {
      if (hand.template !== template.id || hand.chosen === undefined) continue;
      const next = Object.fromEntries(Object.entries(hand.chosen).filter(([g]) => chooses.includes(g)));
      if (Object.keys(next).length > 0) hand.chosen = next; else delete hand.chosen;
    }
  }
  return commit(session, "Edit hand template", `template:${templateId}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
}

export function createTemplate(session: ProjectSession, boxId: string): { result: OpenResult; templateId: string } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const taken = new Set(box.hands.templates.map((t) => effectiveGameId(t)));
  const gameId = freeGameId("new-template", taken);
  const template: HandTemplate<string> = { id: newId("t"), gameId, slots: "unbounded", properties: [] };
  box.hands.templates.push(template);
  const result = commit(session, "New hand template", `struct:${structCounter++}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
  return "error" in result ? result : { result, templateId: template.id };
}

// --- duplicate, for every item type (surface review F5) -------------------------
// The clone gets fresh ids throughout, a pinned deduped gameId (so addresses
// never collide) and a "(copy)" title where the type has one.

function dedupedGameId(base: string, taken: Set<string>): string {
  return freeGameId(`${base}-copy`, taken);
}

export function duplicateDeck(session: ProjectSession, deckId: string): { result: OpenResult; deckId: string } | { error: string } {
  const found = locate(session, deckId);
  if (!found) return { error: `unknown deck (id ${deckId})` };
  const shard = JSON.parse(JSON.stringify(found.deck.shard)) as DeckShard;
  shard.deck.id = newId("k");
  stampOrder(shard.cards);
  for (const c of shard.cards) { c.id = newId("c"); stampOrder(c.outcomes); for (const o of c.outcomes) o.id = newId("o"); }
  const taken = new Set(found.box.decks.map((d) => effectiveGameId(d.shard.deck)));
  shard.deck.gameId = dedupedGameId(effectiveGameId(found.deck.shard.deck), taken);
  if (shard.deck.title !== undefined) shard.deck.title = `${shard.deck.title} (copy)`;
  const content = canonicalStringify(shard satisfies DeckShard);
  const result = commit(session, "Duplicate deck", `struct:${structCounter++}`,
    [{ path: deckPath(session, found.box, effectiveGameId(shard.deck)), content }]);
  return "error" in result ? result : { result, deckId: shard.deck.id };
}

export function duplicateTemplate(session: ProjectSession, boxId: string, templateId: string): { result: OpenResult; templateId: string } | { error: string } {
  const box = locateBox(session, boxId);
  const original = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !original) return { error: `unknown hand template (id ${templateId})` };
  const clone = JSON.parse(JSON.stringify(original)) as HandTemplate<string>;
  clone.id = newId("t");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.hands.templates.map((t) => effectiveGameId(t))));
  if (clone.title !== undefined) clone.title = `${clone.title} (copy)`;
  box.hands.templates.push(clone);
  const result = commit(session, "Duplicate hand template", `struct:${structCounter++}`,
    [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
  return "error" in result ? result : { result, templateId: clone.id };
}

export function duplicateHand(session: ProjectSession, boxId: string, handId: string): { result: OpenResult; handId: string } | { error: string } {
  const box = locateBox(session, boxId);
  const original = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !original) return { error: `unknown hand (id ${handId})` };
  const clone = JSON.parse(JSON.stringify(original)) as Hand<string>;
  clone.id = newId("h");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.hands.hands.map((h) => effectiveGameId(h))));
  if (clone.title !== undefined) clone.title = `${clone.title} (copy)`;
  box.hands.hands.push(clone);
  const result = commit(session, "Duplicate hand", `struct:${structCounter++}`,
    [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
  return "error" in result ? result : { result, handId: clone.id };
}

export function duplicateTagGroup(session: ProjectSession, boxId: string, groupId: string): { result: OpenResult; groupId: string } | { error: string } {
  const box = locateBox(session, boxId);
  const original = box?.tags.groups.find((d) => d.id === groupId);
  if (!box || !original) return { error: `unknown tag group (id ${groupId})` };
  const clone = JSON.parse(JSON.stringify(original)) as TagGroup;
  clone.id = newId("d");
  stampOrder(clone.tags);
  for (const v of clone.tags) v.id = newId("v");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.tags.groups.map((d) => effectiveGameId(d))));
  box.tags.groups.push(clone);
  const result = commit(session, "Duplicate tag group", `struct:${structCounter++}`,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
  return "error" in result ? result : { result, groupId: clone.id };
}

// --- hands ------------------------------------------------------------------
// A hand is a place on the board (schema 2.6): a template instance (chosen
// tags fill its holes) or standalone with its own inline rule, living beside
// its templates in the box's hands shard.

export function handDetail(session: ProjectSession, boxId: string, handId: string): HandDetail | null {
  const box = locateBox(session, boxId);
  const hand = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !hand) return null;
  const groups = byDisplay(box.tags.groups).map((d) => ({
    gameId: effectiveGameId(d), values: byDisplay(d.tags).map((v) => effectiveGameId(v)),
  }));
  const templates = byDisplay(box.hands.templates).map((t) => ({
    gameId: effectiveGameId(t),
    chooses: (t.chooses ?? []).map((gid) => {
      const g = box.tags.groups.find((d) => d.id === gid);
      return g ? effectiveGameId(g) : gid;
    }),
    slots: String(t.slots ?? "unbounded"),
  }));
  const template = hand.template !== undefined
    ? box.hands.templates.find((t) => t.id === hand.template)
    : undefined;
  // One chosen row per hole of the template, carrying any stored tag.
  const chosen = (template?.chooses ?? []).map((groupId) => {
    const group = box.tags.groups.find((d) => d.id === groupId);
    const tagId = hand.chosen?.[groupId];
    const tag = group?.tags.find((x) => x.id === tagId);
    return {
      group: group ? effectiveGameId(group) : groupId,
      value: tag ? effectiveGameId(tag) : "",
      values: byDisplay(group?.tags ?? []).map((v) => effectiveGameId(v)),
    };
  });
  return {
    id: hand.id,
    gameId: effectiveGameId(hand),
    ...(!blank(hand.gameId) ? { gameIdPinned: hand.gameId } : {}),
    ...(hand.title !== undefined ? { title: hand.title } : {}),
    ...(hand.purpose !== undefined ? { purpose: hand.purpose } : {}),
    ...(template !== undefined ? { template: effectiveGameId(template) } : {}),
    chosen,
    ...(hand.rule !== undefined ? {
      rule: {
        bindings: bindingRows(box, hand.rule.bindings, undefined),
        ...(!blank(hand.rule.condition) ? { condition: hand.rule.condition } : {}),
        slots: String(hand.rule.slots ?? "unbounded"),
      },
    } : {}),
    slots: hand.slots === undefined ? "" : String(hand.slots),
    properties: (hand.properties ?? []).map((p) => ({
      name: p.name, type: p.type, default: typeof p.default === "string" ? p.default : JSON.stringify(p.default),
      ...(p.values !== undefined ? { values: p.values } : {}),
    })),
    templates,
    groups,
  };
}

export function saveHand(session: ProjectSession, boxId: string, handId: string, edit: HandEdit): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const hand = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !hand) return { error: `unknown hand (id ${handId})` };
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) hand.gameId = g; else delete hand.gameId; }
  if (edit.title !== undefined) { if (edit.title.trim()) hand.title = edit.title; else delete hand.title; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) hand.purpose = edit.purpose; else delete hand.purpose; }
  if (edit.template !== undefined) {
    if (edit.template === "") {
      // Convert to standalone: an empty rule, exactly one of template / rule.
      delete hand.template;
      delete hand.chosen;
      hand.rule = hand.rule ?? { slots: "unbounded" };
    } else {
      const t = box.hands.templates.find((x) => effectiveGameId(x) === edit.template);
      if (t) {
        hand.template = t.id;
        delete hand.rule;
        // Keep only chosen entries that fill the new template's holes.
        const holes = new Set(t.chooses ?? []);
        const next = Object.fromEntries(Object.entries(hand.chosen ?? {}).filter(([g]) => holes.has(g)));
        if (Object.keys(next).length > 0) hand.chosen = next; else delete hand.chosen;
      }
    }
  }
  if (edit.chosen !== undefined && hand.template !== undefined) {
    const chosen: Record<string, string> = {};
    for (const c of edit.chosen) {
      const group = box.tags.groups.find((d) => effectiveGameId(d) === c.group);
      const tag = group?.tags.find((x) => effectiveGameId(x) === c.value);
      if (group && tag) chosen[group.id] = tag.id;
    }
    if (Object.keys(chosen).length > 0) hand.chosen = chosen; else delete hand.chosen;
  }
  if (edit.rule !== undefined && hand.rule !== undefined) {
    if (edit.rule.bindings !== undefined) {
      const { bindings } = resolveBindingRows(box, edit.rule.bindings);
      if (Object.keys(bindings).length > 0) hand.rule.bindings = bindings; else delete hand.rule.bindings;
    }
    if (edit.rule.condition !== undefined) {
      if (blank(edit.rule.condition)) delete hand.rule.condition; else hand.rule.condition = edit.rule.condition;
    }
    if (edit.rule.slots !== undefined) {
      hand.rule.slots = edit.rule.slots === "unbounded" ? "unbounded"
        : (Number.isInteger(Number(edit.rule.slots)) && edit.rule.slots.trim() ? Number(edit.rule.slots) : "unbounded");
    }
  }
  if (edit.slots !== undefined) {
    const n = Number(edit.slots);
    if (edit.slots.trim() && Number.isInteger(n) && n >= 0) hand.slots = n; else delete hand.slots;
  }
  if (edit.properties !== undefined) hand.properties = edit.properties.filter((d) => d.name.trim()).map(declFromDto);
  return commit(session, "Edit hand", `hand:${handId}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
}

export function createHand(session: ProjectSession, boxId: string): { result: OpenResult; handId: string } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const taken = new Set(box.hands.hands.map((h) => effectiveGameId(h)));
  const title = freeTitle("New hand", taken);
  // Standalone by default (an empty rule pulls the whole stock); pick a
  // template in the editor to instance one instead.
  const hand: Hand<string> = { id: newId("h"), title, rule: { slots: "unbounded" } };
  box.hands.hands.push(hand);
  const result = commit(session, "New hand", `struct:${structCounter++}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
  return "error" in result ? result : { result, handId: hand.id };
}

export function deleteHand(session: ProjectSession, boxId: string, handId: string): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  box.hands.hands = box.hands.hands.filter((h) => h.id !== handId);
  return commit(session, "Delete hand", `struct:${structCounter++}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
}

export function deleteTemplate(session: ProjectSession, boxId: string, templateId: string): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  if (box.hands.hands.some((h) => h.template === templateId)) return { error: "a hand still instances this template" };
  box.hands.templates = box.hands.templates.filter((t) => t.id !== templateId);
  return commit(session, "Delete hand template", `struct:${structCounter++}`, [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
}

export function tagGroupDetail(session: ProjectSession, boxId: string, groupId: string): TagGroupDetail | null {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((d) => d.id === groupId);
  if (!box || !group) return null;
  const asString = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
  const declDtoOf = (p: PropertyDecl): PropertyDeclDto => ({
    name: p.name, type: p.type, default: asString(p.default),
    ...(p.values !== undefined ? { values: p.values } : {}),
    ...(p.stages !== undefined ? { stages: p.stages } : {}),
    ...(p.writable !== undefined ? { writable: p.writable } : {}),
    ...(p.purpose !== undefined ? { purpose: p.purpose } : {}),
  });
  return {
    id: group.id, gameId: effectiveGameId(group),
    ...(group.purpose !== undefined ? { purpose: group.purpose } : {}),
    properties: (group.properties ?? []).map(declDtoOf),
    values: byDisplay(group.tags).map((v) => ({
      id: v.id, gameId: effectiveGameId(v),
      properties: (v.properties ?? []).map(declDtoOf),
      ...(v.values !== undefined
        ? { values: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, asString(x)])) }
        : {}),
    })),
  };
}

export function saveTagGroup(session: ProjectSession, boxId: string, groupId: string, edit: TagGroupEdit): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((d) => d.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) group.gameId = g; else delete group.gameId; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) group.purpose = edit.purpose; else delete group.purpose; }
  if (edit.properties !== undefined) {
    const props = edit.properties.filter((p) => p.name.trim()).map(declFromDto);
    if (props.length > 0) group.properties = props; else delete group.properties;
  }
  if (edit.values !== undefined) {
    // The editor sends what it knows about, which is identity and properties. A tag
    // may also carry a template of play's bag (a zone's polygon), and the editor
    // has never heard of it: carried across by id here, because rebuilding the tag
    // from the DTO alone would erase an afternoon of tracing zones the moment
    // somebody renamed one.
    const kept = new Map(group.tags.map((t) => [t.id, t.templates]));
    group.tags = edit.values.map((v, i): Tag => {
      // `order` from the incoming position, for the reason outcomes carry one.
      const tag: Tag = { id: v.id ?? newId("v"), order: i, gameId: gameIdify(v.gameId) || v.gameId };
      const props = (v.properties ?? []).filter((p) => p.name.trim()).map(declFromDto);
      if (props.length > 0) tag.properties = props;
      // Starting values for what the GROUP declares: parsed against that
      // declaration's type, and a blank means "wherever the group says".
      const declared = new Map((group.properties ?? []).map((d) => [d.name, d]));
      const values: Record<string, ScalarValue> = {};
      for (const [name, raw] of Object.entries(v.values ?? {})) {
        const decl = declared.get(name);
        if (!decl || raw.trim() === "") continue;
        values[name] = coerceDefault(raw, decl.type);
      }
      if (Object.keys(values).length > 0) tag.values = values;
      const templates = v.id !== undefined ? kept.get(v.id) : undefined;
      if (templates !== undefined) tag.templates = templates;
      return tag;
    });
  }
  return commit(session, "Edit tag group", `group:${groupId}`, [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

/**
 * Mark a tag group spatial, or stop.
 *
 * Turning it OFF leaves every polygon where it is. The zones are still zones and
 * the author may be toggling to compare, so throwing away geometry here would be
 * the most expensive undo in the app; validation says the outlines are currently
 * unshown, which is the honest report.
 */
export function setGroupSpatial(
  session: ProjectSession, boxId: string, groupId: string, on: boolean,
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  const templates = withSpatialGroup(group, on);
  if (templates === undefined) delete group.templates;
  else group.templates = templates;
  return commit(session, on ? "Make a map" : "Stop being a map", `group:${groupId}`,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

/**
 * A traced shape for a zone that does not exist yet: declare the tag AND give it the
 * outline, in ONE commit.
 *
 * One commit because it is one act. Two would be two undo steps, and Cmd+Z would
 * leave behind a tag with no shape: a zone the author never asked for, invisible on
 * the map and present in every tag picker in the project.
 */
export function createZone(
  session: ProjectSession, boxId: string, groupId: string, polygon: { x: number; y: number }[],
): { result: OpenResult; tagId: string; rebound: SiteRebinding[] } | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  const taken = new Set(group.tags.map((v) => effectiveGameId(v)));
  const gameId = freeGameId("new-zone", taken);
  const tag: Tag = { id: newId("v"), gameId };
  const templates = withPolygon(tag, polygon);
  if (templates !== undefined) tag.templates = templates;
  group.tags.push(tag);
  // A new outline drawn over existing sites takes those hands in, by the same rule
  // as every other change to either side.
  const rebound = bindSitesToZones(box, groupId);
  const result = commit(session, "Draw a zone", `struct:${structCounter++}`, [
    { path: tagsFile(session, box), content: canonicalStringify(box.tags) },
    ...(rebound.length > 0 ? [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }] : []),
  ]);
  return "error" in result ? result : { result, tagId: tag.id, rebound };
}

/**
 * Set (or clear) a zone's outline. One commit per gesture, so one undo step per
 * traced or dragged shape.
 *
 * The shape having moved, the hands standing in it may have too: a boundary
 * dragged over a pin puts that hand in this zone, and a boundary dragged off one
 * takes it out (and, if nothing else covers it, leaves it loose and erroring).
 * That is the same rule a pin drag obeys, applied from the other side, and it is
 * written in the SAME commit so the geometry and the hands it moved undo as one
 * act.
 */
export function setZonePolygon(
  session: ProjectSession, boxId: string, groupId: string, tagId: string,
  polygon: { x: number; y: number }[] | undefined,
): { result: OpenResult; rebound: SiteRebinding[] } | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  const tag = group?.tags.find((t) => t.id === tagId);
  if (!box || !group || !tag) return { error: `unknown zone (id ${tagId})` };
  const templates = withPolygon(tag, polygon);
  if (templates === undefined) delete tag.templates;
  else tag.templates = templates;
  const rebound = bindSitesToZones(box, groupId);
  // Keyed per zone, so dragging one shape's vertices coalesces into one step while
  // moving a different zone starts a new one.
  const result = commit(session, polygon === undefined ? "Clear a zone" : "Shape a zone", `zone:${tagId}`, [
    { path: tagsFile(session, box), content: canonicalStringify(box.tags) },
    ...(rebound.length > 0 ? [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }] : []),
  ]);
  return "error" in result ? result : { result, rebound };
}

/**
 * Move a zone through the stack: front, forward, backward, back.
 *
 * A VIEW gesture with a content consequence, and it has to be honest about the
 * second half. Which zone owns a pin is the frontmost zone the pin stands in
 * (`zoneAt`), so restacking can rebind hands wherever two zones overlap - a room
 * brought in front of its wing takes the hands standing in it. That is the rule
 * this map already runs on (geometry moves, bindings follow), so it is one
 * commit reporting its rebindings exactly as a reshape does.
 *
 * A move that changes nothing returns without writing: "bring to front" on the
 * frontmost zone should not cost a file write or an undo step.
 */
export function restackZone(
  session: ProjectSession, boxId: string, groupId: string, tagId: string, move: StackMove,
): { result: OpenResult; rebound: SiteRebinding[] } | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  const tag = group?.tags.find((t) => t.id === tagId);
  if (!box || !group || !tag) return { error: `unknown zone (id ${tagId})` };

  // Only DRAWN zones are in the stack: an undrawn tag has no place in a picture.
  const drawn = group.tags.filter((t) => polygonOf(t) !== undefined)
    .map((t) => { const z = zOf(t); return { id: t.id, ...(z !== undefined ? { z } : {}) }; });
  const z = restack(drawn, tagId, move);
  if (z === undefined) return { result: reload(session), rebound: [] };

  tag.templates = withZ(tag, z);
  const rebound = bindSitesToZones(box, groupId);
  // Its OWN undo step, not the `zone:<id>` key a reshape uses. That key exists to
  // coalesce a continuous gesture - dragging one shape's vertices is one edit,
  // however many frames it took - and a restack is a discrete command from a
  // menu. Sharing the key made "bring to front" undo the reshaping that happened
  // before it, which is not what anybody pressing undo once is asking for.
  const result = commit(session, "Restack a zone", `struct:${structCounter++}`, [
    { path: tagsFile(session, box), content: canonicalStringify(box.tags) },
    ...(rebound.length > 0 ? [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }] : []),
  ]);
  return "error" in result ? result : { result, rebound };
}

/**
 * Import a picture behind a map: copy the bytes in, and place them.
 *
 * ONE act, which is why main reads the image's size itself (`imageSize`) rather
 * than letting the renderer load it and place it afterwards: that would be two
 * commits and two undo steps for one gesture. The caller passes its CAMERA - the
 * viewport size, the zoom and where the drop landed - and the rectangle is
 * computed here by the shared rule.
 *
 * The bytes are written straight to disk and are NOT in the undo history, which
 * is deliberate. Undoing the import removes the entry and leaves the file in
 * `assets/`: an orphan file is a much better outcome than an undo that deletes
 * somebody's only copy of a site plan, and a redo finds it still there.
 *
 * The new picture goes to the FRONT of the stack, because an author who has just
 * dropped something wants to see it.
 */
export function addBackground(
  session: ProjectSession, boxId: string, groupId: string,
  source: { name: string; bytes: Uint8Array },
  place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
): { result: OpenResult; file: string } | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  if (!isSpatial(group)) return { error: `"${effectiveGameId(group)}" is not a map` };

  const dir = join(session.loaded.dir, box.path, ASSETS_DIR);
  // Taken names come from BOTH the folder and the bag: a file on disk nothing
  // references is still a name in use, and an entry whose file is missing still
  // owns its name.
  const onDisk = existsSync(dir) ? readdirSync(dir) : [];
  const taken = new Set([...onDisk, ...backgroundsOf(group).map((b) => b.file)]);
  const file = freeAssetName(basename(source.name), taken);
  if (!isSafeAssetName(file)) return { error: `"${source.name}" is not a usable file name` };

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), source.bytes);
  } catch (e) {
    return { error: `could not copy the image: ${e instanceof Error ? e.message : String(e)}` };
  }

  // A format we cannot measure still imports: a square guess is a better outcome
  // than refusing somebody's map (see `imageSize`).
  const natural = imageSize(source.bytes) ?? { width: 1000, height: 1000 };
  const rect = droppedRect(natural, place.view, place.scale, place.at);
  const entry: SpatialBackground = { id: newId("g"), file, ...rect };
  group.templates = withBackgrounds(group, [...backgroundsOf(group), entry]);

  const result = commit(session, "Add a background", `struct:${structCounter++}`,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
  return "error" in result ? result : { result, file };
}

/** What one background edit may change. Geometry and flags in one call, because
 *  they are all "this picture, but different" and a separate mutation each would
 *  be five functions agreeing with each other by hand. */
export interface BackgroundEdit {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
}

/**
 * Change one background: move it, scale it, fade it, hide it, lock it.
 *
 * `coalesce` decides whether this joins the previous edit as one undo step. A
 * drag or a scale is a continuous gesture and coalesces (the same rule vertex
 * dragging uses); a lock, a hide or a fade is a discrete command and gets its own
 * step. Sharing one key for both made "lock" undo the dragging that came before
 * it, which is the mistake the zone restack already taught us once.
 */
export function editBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string,
  edit: BackgroundEdit, opts: { coalesce?: boolean } = {},
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  const current = backgroundsOf(group);
  const at = current.findIndex((b) => b.id === backgroundId);
  if (at < 0) return { error: `unknown background (id ${backgroundId})` };

  const was = current[at]!;
  const next: SpatialBackground = {
    ...was,
    ...(edit.x !== undefined ? { x: edit.x } : {}),
    ...(edit.y !== undefined ? { y: edit.y } : {}),
    // A picture with no area cannot be seen or grabbed to fix, so a scale is
    // floored rather than trusted.
    ...(edit.width !== undefined ? { width: Math.max(1, edit.width) } : {}),
    ...(edit.height !== undefined ? { height: Math.max(1, edit.height) } : {}),
    ...(edit.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, edit.opacity)) } : {}),
  };
  // Flags are cleared rather than written false: an absent key is the default
  // everywhere in these shards, and `hidden: false` is noise in a merge.
  if (edit.hidden !== undefined) { if (edit.hidden) next.hidden = true; else delete next.hidden; }
  if (edit.locked !== undefined) { if (edit.locked) next.locked = true; else delete next.locked; }

  const updated = [...current];
  updated[at] = next;
  group.templates = withBackgrounds(group, updated);
  const key = opts.coalesce === true ? `bg:${backgroundId}` : `struct:${structCounter++}`;
  return commit(session, "Edit a background", key,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

/** Move a background through the stack, among the OTHER BACKGROUNDS only: they are
 *  a band below the zones, so no move can put a picture over one. */
export function restackBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string, move: StackMove,
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  const current = backgroundsOf(group);
  const z = restack(current, backgroundId, move);
  if (z === undefined) return reload(session);

  const updated = current.map((b) => (b.id === backgroundId ? { ...b, z } : b));
  group.templates = withBackgrounds(group, updated);
  return commit(session, "Restack a background", `struct:${structCounter++}`,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

/**
 * Take a picture off the map.
 *
 * The ENTRY goes; the file stays, exactly as an undone import leaves its bytes.
 * It becomes an orphan, and orphans are swept when the session ends (by which
 * point no undo can want them back) - so nothing here deletes anything an undo
 * might need, and nothing accumulates for ever either.
 */
export function removeBackground(
  session: ProjectSession, boxId: string, groupId: string, backgroundId: string,
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  const group = box?.tags.groups.find((g) => g.id === groupId);
  if (!box || !group) return { error: `unknown tag group (id ${groupId})` };
  const current = backgroundsOf(group);
  if (!current.some((b) => b.id === backgroundId)) return { error: `unknown background (id ${backgroundId})` };
  group.templates = withBackgrounds(group, current.filter((b) => b.id !== backgroundId));
  return commit(session, "Remove a background", `struct:${structCounter++}`,
    [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

/** Take hands off the map. The hands themselves are untouched: only their sites. */
export function removeSitesFromMap(
  session: ProjectSession, boxId: string, handIds: string[],
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const write = planForgetSites(session.loaded.dir, box, handIds);
  if (!write) return reload(session);
  return commit(session, "Remove from the map", `map:${structCounter++}`, [{ path: write.path, content: write.content }]);
}

/**
 * Record where a box's hand sites now sit, and REBIND the hands they stand for.
 *
 * The move the map exists for (graphical-views 2): dragging a pin from the docks
 * to the market is not a cosmetic act, it edits the hand's chosen tag. So this
 * writes two shards at once, and deliberately in ONE commit: a position and a
 * binding that arrived from the same gesture must undo as the same gesture, or
 * an undo leaves a pin in the market bound to the docks.
 *
 * `zone` on a placement is the zone the pin LANDED in, null for open ground.
 * Landing on open ground moves the pin and leaves the binding alone: a hand
 * cannot be bound to nowhere (a hole has to be filled), and the likelier reading
 * of a drop between two zones is a nudge that overshot, not "this hand now
 * belongs to no zone". The map draws a pin by its BINDING, so such a pin still
 * shows the colour of the zone that owns it, wherever it has been put down.
 *
 * `bindHand` refuses anything that is not the hand's own to change, so a pin
 * whose group is fixed by its template moves without dragging its siblings.
 */
export function moveSitesOnMap(
  session: ProjectSession, boxId: string, groupId: string, placements: MapSiteMove[],
): { result: OpenResult; rebound: SiteRebinding[] } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };

  const moved: Record<string, { x: number; y: number }> = {};
  for (const p of placements) moved[p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
  const rebound = bindSitesToZones(box, groupId, moved);

  const write = planMapSites(session.loaded.dir, box, placements);
  // Nothing to write: the sites landed where they already were and nobody moved
  // zone. Still a fresh read, so the caller's DTOs and problems are current.
  if (!write && rebound.length === 0) return { result: reload(session), rebound };
  const writes = [
    ...(write ? [{ path: write.path, content: write.content }] : []),
    ...(rebound.length > 0 ? [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }] : []),
  ];
  // Named for what the author did, since it is what an undo will offer back. One
  // commit: a position and a binding from the same gesture undo as one gesture.
  const result = commit(session, rebound.length > 0 ? "Move a hand on the map" : "Move sites",
    `map:${structCounter++}`, writes);
  return "error" in result ? result : { result, rebound };
}

export function createTagGroup(session: ProjectSession, boxId: string): { result: OpenResult; groupId: string } | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const taken = new Set(box.tags.groups.map((d) => effectiveGameId(d)));
  const gameId = freeGameId("new-group", taken);
  const group: TagGroup = { id: newId("d"), gameId, tags: [] };
  box.tags.groups.push(group);
  const result = commit(session, "New tag group", `struct:${structCounter++}`, [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
  return "error" in result ? result : { result, groupId: group.id };
}

export function deleteTagGroup(session: ProjectSession, boxId: string, groupId: string): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  box.tags.groups = box.tags.groups.filter((d) => d.id !== groupId);
  return commit(session, "Delete tag group", `struct:${structCounter++}`, [{ path: tagsFile(session, box), content: canonicalStringify(box.tags) }]);
}

// --- canvas furniture ------------------------------------------------------------

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
export function setCanvasFurniture(
  session: ProjectSession, boxId: string, ref: CanvasRef,
  furniture: CanvasFurniture, label: string, coalesce?: string,
): OpenResult | { error: string } {
  const box = locateBox(session, boxId);
  if (!box) return { error: `unknown box (id ${boxId})` };
  const write = planCanvasFurniture(session.loaded.dir, box, ref, furniture);
  if (!write) return reload(session);   // nothing moved: no file touched, no undo step
  return commit(session, label, coalesce ?? `struct:${structCounter++}`,
    [{ path: write.path, content: write.content }]);
}

// --- threaded comments ---------------------------------------------------------

/**
 * Post a message to a thread, creating the thread if this is its first.
 *
 * The thread is not committed until a message exists, which is Patterpad's rule
 * and a good one: opening a composer and thinking better of it must leave
 * nothing behind. So there is no "create a thread" call at all - posting IS
 * creating.
 */
export function postComment(
  session: ProjectSession, anchor: string, threadId: string, author: string, body: string,
  mark?: CommentMark,
): OpenResult | { error: string } {
  const box = boxOwning(session, anchor);
  if (!box) return { error: "that is not something a comment can be attached to" };
  const message = { author, ts: new Date().toISOString(), body };
  const threads = commentsOf(box.notes);
  const at = threads.findIndex((t) => t.id === threadId);
  // `mark` belongs to a thread's CREATION only. A reply must not be able to move
  // a marker, or a comment would jump because somebody answered it from the
  // other canvas; moving is `moveComment`, its own gesture and its own undo step.
  const next = at >= 0
    ? threads.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t))
    : [...threads, { id: threadId, anchor, ...(mark ? { mark } : {}), messages: [message] }];
  return writeComments(session, box, next, at >= 0 ? "Reply to a comment" : "Add a comment");
}

/**
 * Move a marker, re-deciding what it is anchored to from where it LANDED.
 *
 * That is what makes detaching free: dropped on an item it follows that item
 * (with `x`/`y` as the offset), dropped on empty canvas it stays put (with `x`/`y`
 * as canvas coordinates), and dragging one off a card is the second case
 * happening. Nothing remembers what it used to be attached to.
 *
 * One undo step per drag, keyed to the gesture like every other move.
 */
export function moveComment(
  session: ProjectSession, threadId: string, canvas: string, x: number, y: number, item?: string,
): OpenResult | { error: string } {
  const box = session.loaded.source?.boxes.find((b) => commentsOf(b.notes).some((t) => t.id === threadId));
  if (!box) return { error: "no such comment" };
  const next = commentsOf(box.notes).map((t) =>
    (t.id === threadId ? { ...t, anchor: item ?? canvas, mark: { canvas, x, y } } : t));
  return writeComments(session, box, next, "Move a comment");
}

/** Mark a thread complete, or reopen it. */
export function setCommentResolved(
  session: ProjectSession, threadId: string, resolved: boolean,
): OpenResult | { error: string } {
  const box = session.loaded.source?.boxes.find((b) => commentsOf(b.notes).some((t) => t.id === threadId));
  if (!box) return { error: "no such comment" };
  const next = commentsOf(box.notes).map((t) => {
    if (t.id !== threadId) return t;
    const copy = { ...t };
    if (resolved) copy.resolved = true; else delete copy.resolved;
    return copy;
  });
  return writeComments(session, box, next, resolved ? "Mark a comment complete" : "Reopen a comment");
}

/**
 * Withdraw one message from a thread.
 *
 * ONE rule, which covers both halves of what was asked for: the message becomes
 * a tombstone, and the whole thread goes when nothing readable would be left.
 *
 * Stated as two rules ("solo deletes, in-thread tombstones") it has a dead end:
 * withdraw all three messages of a three-message thread one at a time and you
 * are left with three tombstones and no way to be rid of them. Read as one rule,
 * the solo case falls out of it - a lone message withdrawn leaves nothing to
 * read, so the thread goes - and so does the last-one-out case.
 *
 * The body is EMPTIED rather than kept beside a flag. "Deleted" has to mean gone
 * from the file: the person reaching for this may have typed something they
 * regret, and a shard that still holds it, in a directory under version control,
 * would be the opposite of what they asked for.
 */
export function deleteCommentMessage(
  session: ProjectSession, threadId: string, index: number,
): OpenResult | { error: string } {
  const box = session.loaded.source?.boxes.find((b) => commentsOf(b.notes).some((t) => t.id === threadId));
  if (!box) return { error: "no such comment" };
  const threads = commentsOf(box.notes);
  const thread = threads.find((t) => t.id === threadId)!;
  const target = thread.messages[index];
  if (!target) return { error: "that comment has already gone" };
  if (target.deleted === true) return { error: "that comment is already deleted" };

  const messages = thread.messages.map((m, i) =>
    (i === index ? { author: m.author, ts: m.ts, body: "", deleted: true as const } : m));
  const readable = messages.some((m) => m.deleted !== true);
  const next = readable
    ? threads.map((t) => (t.id === threadId ? { ...t, messages } : t))
    : threads.filter((t) => t.id !== threadId);
  return writeComments(session, box, next, "Delete a comment");
}

function writeComments(
  session: ProjectSession, box: SourceBox, threads: Comment[], label: string,
): OpenResult | { error: string } {
  const write = planComments(session.loaded.dir, box, threads);
  if (!write) return reload(session);
  return commit(session, label, `struct:${structCounter++}`,
    [{ path: write.path, content: write.content }]);
}

/**
 * Which box holds the thing this id names.
 *
 * Every commentable id, which is now every item type plus the two kinds of
 * canvas. OUTCOMES were missing when outcome comments were added, so posting on
 * one was refused - found by writing this function's other half rather than by
 * using the app, because opening the popover works and only POSTING fails.
 *
 * A canvas anchor is a comment about a PLACE (design/annotation.md 3): a deck id
 * is already an item id above, and `map:<boxId>` names a box's map.
 */
function boxOwning(session: ProjectSession, id: string): SourceBox | undefined {
  const boxes = session.loaded.source?.boxes ?? [];
  const mapOf = id.startsWith(MAP_CANVAS) ? id.slice(MAP_CANVAS.length) : undefined;
  for (const box of boxes) {
    if (box.box.box.id === id || box.box.box.id === mapOf) return box;
    for (const deck of box.decks) {
      if (deck.shard.deck.id === id) return box;
      for (const card of deck.shard.cards) {
        if (card.id === id) return box;
        if (card.outcomes.some((o) => o.id === id)) return box;
      }
    }
    if (box.hands.hands.some((h) => h.id === id)) return box;
    if (box.hands.templates.some((t) => t.id === id)) return box;
    if (box.tags.groups.some((g) => g.id === id)) return box;
  }
  return undefined;
}

// --- the problems bar's quick-fixes (storyletter.md section 4) ----------------
//
// Two repairs, and only two, because only these two are CANONICAL: there is
// exactly one sensible thing to do and no judgement in doing it. A fix that has
// to guess is a fix that will be wrong in front of somebody, and undoing a
// surprise costs more than the click saved. Both go through `commit`, so both
// are one undo step like any other edit.

/**
 * Declare a property that something already refers to.
 *
 * The type is inferred from nothing at all: it is a NUMBER with a default of 0,
 * which is the commonest case and, more to the point, the one an author can see
 * and change in the editor the fix drops them beside. Guessing from the
 * comparison literals was the first idea and it is a trap - a condition that
 * says `> 0` tells you the property is numeric, and one that says `== "yes"`
 * tells you nothing about whether the author wanted a string or an enum.
 */
export function declareProperty(
  session: ProjectSession, scope: string, name: string, owner: string,
  guess?: { type: PropertyDecl["type"]; default: ScalarValue },
): OpenResult | { error: string } {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  // The type read off the value being written, where the compiler could read
  // it; a number defaulting to 0 where it could not, which is the old guess.
  const decl: PropertyDecl = guess !== undefined
    ? { name, type: guess.type, default: guess.default }
    : { name, type: "number", default: 0 };

  if (scope === "story" || scope === "world") {
    const holder = scope === "story" ? source.project.story : source.project.world;
    if (holder.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    holder.properties.push(decl);
    return commit(session, `Declare @${scope}.${name}`, `struct:${structCounter++}`,
      [{ path: join(session.loaded.dir, source.path), content: canonicalStringify(source.project) }]);
  }

  if (scope === "box") {
    const box = source.boxes.find((b) => b.box.box.id === owner);
    if (!box) return { error: `unknown box (id ${owner})` };
    if (box.box.box.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    box.box.box.properties.push(decl);
    return commit(session, `Declare @box.${name}`, `struct:${structCounter++}`,
      [{ path: boxFile(session, box), content: canonicalStringify(box.box) }]);
  }

  if (scope === "deck") {
    const found = locate(session, owner);
    if (!found) return { error: `unknown deck (id ${owner})` };
    if (found.deck.shard.deck.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    found.deck.shard.deck.properties.push(decl);
    return commit(session, `Declare @deck.${name}`, `struct:${structCounter++}`,
      [deckFileState(session, found.deck, deckContent(found.deck))]);
  }

  // @hand is composed per deal rather than declared in one place, so there is no
  // single shard to write it to and no canonical fix. The bar does not offer one.
  return { error: `@${scope} properties are not declared in one place` };
}

/**
 * Point a dangling tag reference at a real tag in its group.
 *
 * The holder is found by ID across cards and hands rather than being told which
 * it is: the two carry a tag the same way as far as this repair is concerned,
 * and a caller that had to say "card" or "hand" would be re-deriving something
 * the project already knows.
 */
export function repointTag(
  session: ProjectSession, holder: string, group: string, from: string, to: string,
): OpenResult | { error: string } {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };

  for (const box of source.boxes) {
    for (const hand of box.hands.hands) {
      if (hand.id !== holder || hand.chosen?.[group] !== from) continue;
      hand.chosen = { ...hand.chosen, [group]: to };
      return commit(session, "Fix tag", `struct:${structCounter++}`,
        [{ path: handsFile(session, box), content: canonicalStringify(box.hands) }]);
    }
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) {
        const tags = card.tags?.[group];
        // Matched by gameId as well as by id, because a card's `where` in the
        // diagnostic is its gameId: the compiler reports the holder by the name
        // an author would recognise, and the id is not always what came back.
        if ((card.id !== holder && effectiveGameId(card) !== holder) || !tags?.includes(from)) continue;
        card.tags = { ...card.tags, [group]: tags.map((t) => (t === from ? to : t)) };
        return commit(session, "Fix tag", `struct:${structCounter++}`,
          [deckFileState(session, deck, deckContent(deck))]);
      }
    }
  }
  return { error: "that tag reference has already gone" };
}
