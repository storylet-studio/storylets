// ---------------------------------------------------------------------------
// The problems bar's quick-fixes (storyletter.md section 4), and the two the
// other surfaces offer: the Patter link's missing outcome, and the Coverage
// window's proposed drivers.
//
// Only repairs that are CANONICAL: there is exactly one sensible thing to do
// and no judgement in doing it. A fix that has to guess is a fix that will be
// wrong in front of somebody, and undoing a surprise costs more than the click
// saved. Every one goes through `commit`, so every one is one undo step like
// any other edit.
// ---------------------------------------------------------------------------

import { worldDeclarations } from "@storylet-studio/compiler";
import { newId, proposeCoverage } from "@storylet-studio/ops";
import { effectiveGameId, isValidGameId } from "@storylet-studio/model";
import type { CoverageConfig, Outcome, PropertyDecl, ScalarValue } from "@storylet-studio/model";
import { gameWorldWrite } from "../game-scopes.js";
import type { ProjectSession } from "../project.js";
import type { OpenResult } from "../../shared/api.js";
import { commit, commitMaking, freshKey } from "./write-path.js";
import type { Written } from "./write-path.js";
import { boxWrite, deckWrite, gone, handsWrite, locate, projectWrite } from "./shards.js";

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
export async function declareProperty(
  session: ProjectSession, scope: string, name: string, owner: string,
  guess?: { type: PropertyDecl["type"]; default: ScalarValue },
): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  // The type read off the value being written, where the compiler could read
  // it; a number defaulting to 0 where it could not, which is the old guess.
  const decl: PropertyDecl = guess !== undefined
    ? { name, type: guess.type, default: guess.default }
    : { name, type: "number", default: 0 };

  if (scope === "story" || scope === "world") {
    const holder = scope === "story" ? source.project.story : source.project.world;
    // @world, where the game shares it, is declared in the game's file first and copied
    // into the project, exactly as the World settings do it.
    if (scope === "world") holder.properties = [...worldDeclarations(source)];
    if (holder.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    holder.properties.push(decl);
    const shared = scope === "world" ? gameWorldWrite(source, holder.properties) : [];
    if ("error" in shared) return shared;
    return commit(session, `Declare @${scope}.${name}`, freshKey(), [...shared, projectWrite(session)]);
  }

  if (scope === "box") {
    const box = source.boxes.find((b) => b.box.box.id === owner);
    if (!box) return gone("box");
    if (box.box.box.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    box.box.box.properties.push(decl);
    return commit(session, `Declare @box.${name}`, freshKey(), [boxWrite(session, box)]);
  }

  if (scope === "deck") {
    const found = locate(session, owner);
    if (!found) return gone("deck");
    if (found.deck.shard.deck.properties.some((p) => p.name === name)) return { error: `"${name}" is already declared` };
    found.deck.shard.deck.properties.push(decl);
    return commit(session, `Declare @deck.${name}`, freshKey(), [deckWrite(session, found.deck)]);
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
export async function repointTag(
  session: ProjectSession, holder: string, group: string, from: string, to: string,
): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };

  for (const box of source.boxes) {
    for (const hand of box.hands.hands) {
      if (hand.id !== holder || hand.chosen?.[group] !== from) continue;
      hand.chosen = { ...hand.chosen, [group]: to };
      return commit(session, "Fix tag", freshKey(), [handsWrite(session, box)]);
    }
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) {
        const tags = card.tags?.[group];
        // Matched by gameId as well as by id, because a card's `where` in the
        // diagnostic is its gameId: the compiler reports the holder by the name
        // an author would recognise, and the id is not always what came back.
        if ((card.id !== holder && effectiveGameId(card) !== holder) || !tags?.includes(from)) continue;
        card.tags = { ...card.tags, [group]: tags.map((t) => (t === from ? to : t)) };
        return commit(session, "Fix tag", freshKey(), [deckWrite(session, deck)]);
      }
    }
  }
  return { error: "that tag reference has already gone" };
}

/**
 * The Patter quick fix (ops `patter-link.ts`): the card's paired scene names an outcome the card
 * doesn't have, so give it one by that name. The gameId is PINNED to the scene's name, since that
 * name is the link and must not move if the title is edited; the title is read off it
 * ("pay-them-off" -> "Pay them off") for the author to improve. Placed after the card's others.
 */
export async function addNamedOutcome(session: ProjectSession, cardId: string, gameId: string):
  Promise<{ result: OpenResult; box: string; deck: string; outcome: string } | { error: string }> {
  if (!isValidGameId(gameId)) return { error: `"${gameId}" isn't a legal outcome name` };
  for (const box of session.loaded.source!.boxes) {
    for (const deck of box.decks) {
      const card = deck.shard.cards.find((c) => c.id === cardId);
      if (!card) continue;
      if (card.outcomes.some((o) => effectiveGameId(o) === gameId)) return { error: `this card already has an outcome "${gameId}"` };
      const words = gameId.replace(/-/g, " ");
      const order = Math.max(-1, ...card.outcomes.map((o, i) => o.order ?? i)) + 1;
      const outcome: Outcome<string> = { id: newId("o"), gameId, title: words.charAt(0).toUpperCase() + words.slice(1), order, changes: {} };
      card.outcomes.push(outcome);
      return commitMaking(session, `Add outcome ${gameId}`, freshKey(), [deckWrite(session, deck)],
        { box: box.box.box.id, deck: deck.shard.deck.id, outcome: outcome.id });
    }
  }
  return gone("card");
}

/** Propose coverage drivers from the conditions and merge them into the
 *  project shard (existing author config wins). Undoable; returns the refs
 *  added. */
export async function addCoverageDrivers(session: ProjectSession): Promise<{ result: OpenResult; added: string[] } | { error: string }> {
  const source = session.loaded.source!;
  const { coverage } = proposeCoverage(source);
  const existing = source.project.coverage ?? {};
  const mergedDrivers = { ...(coverage.drivers ?? {}), ...(existing.drivers ?? {}) };
  const added = Object.keys(coverage.drivers ?? {}).filter((ref) => !(existing.drivers ?? {})[ref]);

  const merged: CoverageConfig = {};
  if (Object.keys(mergedDrivers).length > 0) merged.drivers = mergedDrivers;
  source.project.coverage = merged;

  return commitMaking(session, "Add coverage drivers", freshKey(), [projectWrite(session)], { added });
}
