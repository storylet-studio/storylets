// ---------------------------------------------------------------------------
// The project's structure: boxes, decks and a box's own tag groups. Making,
// copying, ordering, renaming and deleting them.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import { boxFolderWrites, newId, runNewBox } from "@storylet-studio/ops";
import { DECK_SCHEMA, PLACE_GROUP, effectiveGameId, freeGameId, freeTitle, gameIdify, isValidGameId } from "@storylet-studio/model";
import type { BoxShard, DeckShard, HandsShard, ScalarValue, Tag, TagGroup, TagsShard } from "@storylet-studio/model";
import { plural } from "@wildwinter/app-shell/util";
import type { FileState } from "../history.js";
import type { ProjectSession } from "../project.js";
import { coerceDefault, declFromDto, declsFromDtos } from "../decls.js";
import type { BoxEdit, BoxKit, DeckEdit, OpenResult, TagGroupEdit } from "../../shared/api.js";
import { commit, commitMaking, freshKey, refuse } from "./write-path.js";
import type { Written } from "./write-path.js";
import {
  allDeckGameIds, applyIdentity, blank, boxFile, boxWrite, dedupedGameId, deckFileState, deckPath, deckWrite, gone,
  handsFile, locate, locateBox, mapGroupHome, midpointOrder, projectWrite, stampOrder, tagsFile, tagsWrite,
} from "./shards.js";

// --- boxes -----------------------------------------------------------------------

// Kits (Blank / RPG) live in ops (runNewBox), so the CLI's `new box --kit`
// and this editor scaffold the identical box: one core, many front-ends.
export async function createBox(session: ProjectSession, kit: BoxKit = "blank"): Promise<{ result: OpenResult; boxId: string } | { error: string }> {
  try {
    const planned = runNewBox({ loaded: session.loaded, kit });
    return await commitMaking(session, "New box", freshKey(),
      planned.writes.map((w): FileState => ({ path: w.path, content: w.content })), { boxId: planned.boxId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveBox(session: ProjectSession, boxId: string, edit: BoxEdit): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const b = box.box.box;
  applyIdentity(b, edit);
  if (edit.ranking !== undefined) b.ranking = { specificity: edit.ranking.specificity };
  // Turns: an object makes the box timed, null puts it back to counting plays.
  // Deleted rather than written as absent, so a box that is not timed carries
  // no `turn` key at all and the shard reads as it always did.
  if (edit.turn !== undefined) { if (edit.turn === null) delete b.turn; else b.turn = { seconds: edit.turn.seconds }; }
  if (edit.fields !== undefined) b.fields = edit.fields.map(declFromDto);
  // The outcome half of the template. Deleted when the list empties rather
  // than written as `outcomeFields: []`, the way `turn` is: a box that declares
  // none must carry no key, so a project that has never seen an outcome field
  // saves back exactly as it was read.
  if (edit.outcomeFields !== undefined) {
    if (edit.outcomeFields.length > 0) b.outcomeFields = edit.outcomeFields.map(declFromDto);
    else delete b.outcomeFields;
  }
  if (edit.properties !== undefined) b.properties = edit.properties.map(declFromDto);
  const writes: FileState[] = [boxWrite(session, box)];
  // Performed by Patter lives on the PROJECT (`patterBoxes`, never compiled), so this one edit
  // writes the project shard too, in the same undo step. Absent when no box is named.
  if (edit.patterPerformed !== undefined) {
    const source = session.loaded.source!;
    const ids = new Set(source.project.patterBoxes ?? []);
    if (edit.patterPerformed) ids.add(boxId); else ids.delete(boxId);
    if (ids.size > 0) source.project.patterBoxes = [...ids].sort(); else delete source.project.patterBoxes;
    writes.push(projectWrite(session));
  }
  return commit(session, "Edit box", `box:${boxId}`, writes);
}

export async function moveBox(session: ProjectSession, boxId: string, targetId: string, before: boolean): Promise<Written> {
  const boxes = session.loaded.source!.boxes;
  const order = midpointOrder(boxes.map((b) => b.box.box), boxId, targetId, before);
  if (typeof order !== "number") return order;
  const moved = boxes.find((b) => b.box.box.id === boxId)!;
  moved.box.box.order = order;
  return commit(session, "Reorder boxes", freshKey(), [boxWrite(session, moved)]);
}

/** Delete a whole box: every shard in its folder, in one undoable step (the
 *  file-state history holds the before-images, so Cmd+Z restores it all).
 *  The renderer confirms first - this is the big red switch. */
export async function deleteBox(session: ProjectSession, boxId: string): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const writes: FileState[] = [
    { path: boxFile(session, box), content: null },
    { path: tagsFile(session, box), content: null },
    { path: handsFile(session, box), content: null },
    ...box.decks.map((d) => ({ path: join(session.loaded.dir, d.path), content: null })),
  ];
  return commit(session, "Delete box", freshKey(), writes);
}

/** Duplicate a whole box: a new folder, fresh ids THROUGHOUT with every
 *  cross-reference remapped (bindings, chosen, card tags, home hands,
 *  template pointers), deduped gameId, "(copy)" title. */
export async function duplicateBox(session: ProjectSession, boxId: string): Promise<{ result: OpenResult; boxId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");

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
  // Deck gameIds likewise (their addresses name no box).
  const deckNames = allDeckGameIds(session);
  for (const deck of src.decks) {
    deck.deck.gameId = dedupedGameId(effectiveGameId(deck.deck), deckNames);
    deckNames.add(deck.deck.gameId);
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
  return commitMaking(session, "Duplicate box", freshKey(), writes, { boxId: newBoxId });
}

// --- decks -----------------------------------------------------------------------

export async function createDeck(session: ProjectSession, boxId: string): Promise<{ result: OpenResult; deckId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const title = freeTitle("New deck", allDeckGameIds(session));
  const shard: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title, properties: [] },
    cards: [],
  };
  const path = deckPath(session, box, effectiveGameId(shard.deck));
  if ("error" in path) return path;
  return commitMaking(session, "New deck", freshKey(),
    [{ path: path.path, content: canonicalStringify(shard) }], { deckId: shard.deck.id });
}

export async function moveDeck(session: ProjectSession, deckId: string, targetId: string, before: boolean): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  const order = midpointOrder(found.box.decks.map((d) => d.shard.deck), deckId, targetId, before);
  if (typeof order !== "number") return order;
  found.deck.shard.deck.order = order;
  return commit(session, "Reorder decks", freshKey(), [deckWrite(session, found.deck)]);
}

export async function deleteDeck(session: ProjectSession, deckId: string): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  if (found.deck.shard.cards.length > 0) {
    return { error: "delete the deck's cards first (a non-empty deck is not removed by accident)" };
  }
  return commit(session, "Delete deck", freshKey(), [deckFileState(session, found.deck, null)]);
}

export async function renameDeck(session: ProjectSession, deckId: string, edit: DeckEdit): Promise<Written> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  // The deck's address names its FILE, and this is the one edit that can reach
  // the write with a gameId the editor never sanitised: renaming only the TITLE
  // leaves a pinned gameId untouched, so a shard that arrived from somewhere
  // else (hand-edited, unpacked, merged) carries whatever it carries. Said
  // plainly here; deckPath refuses as a backstop.
  const pinnedNow = found.deck.shard.deck.gameId?.trim();
  if (pinnedNow !== undefined && pinnedNow !== "" && !isValidGameId(pinnedNow)) {
    return { error: `this deck's gameId "${pinnedNow}" is not a legal address, so it cannot be saved under it. Fix the gameId first.` };
  }
  const deck = found.deck.shard.deck;
  const oldPath = join(session.loaded.dir, found.deck.path);
  const oldEffective = effectiveGameId(deck);
  applyIdentity(deck, edit);
  if (edit.gate !== undefined) {
    if (blank(edit.gate)) delete deck.condition;
    else deck.condition = edit.gate;
  }
  if (edit.shared !== undefined) {
    // Written only when true: absent is the default and keeps the shard quiet.
    if (edit.shared) deck.shared = true;
    else delete deck.shared;
  }
  if (edit.durable !== undefined) {
    if (edit.durable) deck.durable = true;
    else delete deck.durable;
  }
  if (edit.properties !== undefined) deck.properties = declsFromDtos(edit.properties);

  // The file name tracks the deck's EFFECTIVE gameId (pinned, or derived from
  // the title), so a rename never leaves the drift validate would warn about.
  const newEffective = effectiveGameId(deck);
  const moved = newEffective !== oldEffective;
  const content = canonicalStringify(found.deck.shard);
  const target = moved ? deckPath(session, found.box, newEffective) : { path: oldPath };
  if ("error" in target) return refuse(session, target.error);
  const writes: FileState[] = moved
    ? [{ path: target.path, content }, { path: oldPath, content: null }]
    : [{ path: oldPath, content }];
  return commit(session, "Rename deck", `rename:${deckId}`, writes);
}

// The clone gets fresh ids throughout, a pinned deduped gameId (so addresses
// never collide) and a "(copy)" title where the type has one (surface review
// F5). The box's own copy is `duplicateBox` above, and the hand's and
// template's are in hands.ts.
export async function duplicateDeck(session: ProjectSession, deckId: string): Promise<{ result: OpenResult; deckId: string } | { error: string }> {
  const found = locate(session, deckId);
  if (!found) return gone("deck");
  const shard = JSON.parse(JSON.stringify(found.deck.shard)) as DeckShard;
  shard.deck.id = newId("k");
  stampOrder(shard.cards);
  for (const c of shard.cards) { c.id = newId("c"); stampOrder(c.outcomes); for (const o of c.outcomes) o.id = newId("o"); }
  shard.deck.gameId = dedupedGameId(effectiveGameId(found.deck.shard.deck), allDeckGameIds(session));
  if (shard.deck.title !== undefined) shard.deck.title = `${shard.deck.title} (copy)`;
  const content = canonicalStringify(shard satisfies DeckShard);
  const path = deckPath(session, found.box, effectiveGameId(shard.deck));
  if ("error" in path) return path;
  return commitMaking(session, "Duplicate deck", freshKey(), [{ path: path.path, content }], { deckId: shard.deck.id });
}

// --- a box's own tag groups ------------------------------------------------------

export async function createTagGroup(session: ProjectSession, boxId: string): Promise<{ result: OpenResult; groupId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const taken = new Set(box.tags.groups.map((d) => effectiveGameId(d)));
  const gameId = freeGameId("new-group", taken);
  const group: TagGroup = { id: newId("d"), gameId, tags: [] };
  box.tags.groups.push(group);
  return commitMaking(session, "New tag group", freshKey(), [tagsWrite(session, box)], { groupId: group.id });
}

export async function duplicateTagGroup(session: ProjectSession, boxId: string, groupId: string): Promise<{ result: OpenResult; groupId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  const original = box?.tags.groups.find((d) => d.id === groupId);
  if (!box || !original) return gone("tag group");
  const clone = JSON.parse(JSON.stringify(original)) as TagGroup;
  clone.id = newId("d");
  stampOrder(clone.tags);
  for (const v of clone.tags) v.id = newId("v");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.tags.groups.map((d) => effectiveGameId(d))));
  box.tags.groups.push(clone);
  return commitMaking(session, "Duplicate tag group", freshKey(), [tagsWrite(session, box)], { groupId: clone.id });
}

export async function saveTagGroup(session: ProjectSession, boxId: string, groupId: string, edit: TagGroupEdit): Promise<Written> {
  const home = mapGroupHome(session, boxId, groupId);
  const group = home?.group;
  if (!home || !group) return gone("tag group");
  // A group has no title of its own to edit: its address and its purpose.
  applyIdentity(group, { gameId: edit.gameId, purpose: edit.purpose });
  if (edit.properties !== undefined) {
    const props = declsFromDtos(edit.properties);
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
      const props = declsFromDtos(v.properties ?? []);
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
  return commit(session, "Edit tag group", `group:${groupId}`, [home.write()]);
}

/**
 * Delete a tag group. Refused while any of the box's cards is still tagged
 * with it, naming how many, as a deck with cards in it is refused (review
 * 2026-10, item 15): deleting one in use left an error per card behind. The
 * renderer confirms by the same evidence before it asks.
 */
export async function deleteTagGroup(session: ProjectSession, boxId: string, groupId: string): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const group = box.tags.groups.find((d) => d.id === groupId);
  if (!group) return gone("tag group");
  const tagged = box.decks.reduce((n, d) => n + d.shard.cards.filter((c) => (c.tags?.[groupId] ?? []).length > 0).length, 0);
  if (tagged > 0) {
    return { error: `${plural(tagged, "card")} ${tagged === 1 ? "is" : "are"} still tagged with "${effectiveGameId(group)}": take the tags off first (a group in use is not removed by accident)` };
  }
  box.tags.groups = box.tags.groups.filter((d) => d.id !== groupId);
  return commit(session, "Delete tag group", freshKey(), [tagsWrite(session, box)]);
}
